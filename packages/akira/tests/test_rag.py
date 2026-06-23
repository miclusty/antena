"""Direct tests for ``core.rag.RAGEngine``.

Covers the previously-untested RAG pipeline (T1 in the AKIRA Iter 4
code review). The PR 1 fix added a 3-test smoke test that only proved
imports resolve; this file exercises the actual ``assemble()`` and
``synthesize()`` paths against a real (temp) SQLite DB.

Strategy:
  - Real temp SQLite DBs (mirror ``test_rag_smoke._make_temp_db``).
  - Schema seeded per-test from a single ``_seed_full_schema()``
    helper that creates the minimal tables the engine touches
    (``news_cards``, ``sources``, ``news_embeddings``, ``entities``,
    ``entity_mentions``, ``entity_co_occurrences``, ``rag_queries``).
  - ``LMStudioClient`` is replaced with a ``MagicMock`` per-test so
    no network is hit. The mock supports ``chat``, ``embed``, and
    ``rerank`` because the RAG pipeline calls all three.

Vector dimension is the real ``VECTOR_DIM = 768`` from ``core.rag``.
We mock ``embed()`` to return the same 768-dim vector the
``news_embeddings`` rows use, which yields cosine similarity 1.0
and passes the ``KNN_MIN_SIMILARITY = 0.70`` threshold cleanly.
"""
from __future__ import annotations

import json
import os
import sqlite3
import tempfile
from typing import List
from unittest.mock import MagicMock

import numpy as np
import pytest

from core.rag import RAGEngine, RAGContext, SynthesizedPerspectives, VECTOR_DIM


# ─── helpers ───────────────────────────────────────────────────────


def _make_temp_db() -> str:
    """Create a temp SQLite file path. Caller is responsible for cleanup.

    Mirrors ``test_rag_smoke._make_temp_db`` — the temp path is used
    instead of ``:memory:`` because some queries (e.g. entity
    co-occurrence traversal) open multiple connections, and the
    shared WAL/mmap PRAGMAs in ``db.connection.get_db_connection``
    require a file-backed DB to apply correctly.
    """
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    return path


def _seed_full_schema(db_path: str) -> None:
    """Create every table the RAG engine touches.

    Schema matches the production tables (see ``scripts/embed_cards.py``
    for ``news_embeddings``, ``scripts/extract_entities.py`` for
    ``entities`` / ``entity_mentions``, ``scripts/build_kb.py`` for
    ``entity_co_occurrences``). ``master_articles`` and
    ``rag_queries`` are added because ``_log_query`` writes to the
    latter on successful synthesis.
    """
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE sources (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            url TEXT,
            avg_bias REAL
        );
        CREATE TABLE news_cards (
            id TEXT PRIMARY KEY,
            cluster_id TEXT,
            title TEXT,
            summary TEXT,
            source_ids TEXT,
            bias_score REAL DEFAULT 0,
            bias_reasoning TEXT,
            is_gacetilla INTEGER DEFAULT 0,
            location_id INTEGER,
            published_at TEXT,
            source_url TEXT
        );
        CREATE TABLE news_embeddings (
            card_id TEXT PRIMARY KEY,
            embedding TEXT NOT NULL,
            model TEXT NOT NULL DEFAULT 'text-embedding-nomic-embed-text-v1.5',
            computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE entities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            aliases TEXT,
            first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            mention_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (name)
        );
        CREATE TABLE entity_mentions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            card_id TEXT NOT NULL,
            entity_id INTEGER NOT NULL,
            confidence REAL NOT NULL DEFAULT 1.0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (card_id, entity_id)
        );
        CREATE TABLE entity_co_occurrences (
            entity_a_id INTEGER NOT NULL,
            entity_b_id INTEGER NOT NULL,
            card_count INTEGER NOT NULL DEFAULT 0,
            last_seen TEXT NOT NULL,
            PRIMARY KEY (entity_a_id, entity_b_id)
        );
        CREATE TABLE master_articles (
            id TEXT PRIMARY KEY,
            cluster_id TEXT,
            title TEXT,
            summary TEXT,
            neutral_perspective TEXT,
            officialist_perspective TEXT,
            opposition_perspective TEXT,
            verified_facts TEXT,
            disputed_claims TEXT,
            sources_count INTEGER DEFAULT 0,
            bias_min REAL,
            bias_max REAL,
            bias_avg REAL,
            created_at TEXT
        );
        CREATE TABLE rag_queries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cluster_id TEXT,
            model TEXT,
            prompt_tokens INTEGER,
            completion_tokens INTEGER,
            neighbors_used TEXT,
            entities_used TEXT,
            perspectives TEXT,
            latency_ms INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    conn.commit()
    conn.close()


def _seed_cluster(db_path: str, cluster_id: str, n_cards: int = 3) -> None:
    """Insert ``n_cards`` articles into a cluster with a real-looking
    title + summary. Summary is > 30 chars so ``_fetch_cluster_articles``
    doesn't filter it out (the WHERE clause requires LENGTH(summary) > 30)."""
    conn = sqlite3.connect(db_path)
    # Source 1 is shared by all cluster cards.
    conn.execute(
        "INSERT INTO sources (id, name, url, avg_bias) "
        "VALUES (1, 'Test Source', 'https://example.com', 0.0)"
    )
    for i in range(n_cards):
        title = f"Presidente Milei announces economic plan {i}"
        summary = (
            f"El presidente anunció nuevas medidas económicas para "
            f"estabilizar el peso y reducir la inflación en Argentina número {i}."
        )
        conn.execute(
            "INSERT INTO news_cards "
            "(id, cluster_id, title, summary, source_ids, bias_score) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (f"c{i}", cluster_id, title, summary, "1", 0.0),
        )
    conn.commit()
    conn.close()


def _seed_embeddings(db_path: str, card_ids: List[str], vec: List[float]) -> None:
    """Insert ``news_embeddings`` rows for the given cards, all sharing
    the same vector. Used so KNN can find them with cosine sim 1.0."""
    conn = sqlite3.connect(db_path)
    for cid in card_ids:
        conn.execute(
            "INSERT INTO news_embeddings (card_id, embedding, model) "
            "VALUES (?, ?, 'text-embedding-nomic-embed-text-v1.5')",
            (cid, json.dumps(vec)),
        )
    conn.commit()
    conn.close()


def _mock_lm_client() -> MagicMock:
    """Build a MagicMock that mimics ``LMStudioClient``'s contract.

    - ``embed(text)`` returns a fixed 768-dim unit vector.
    - ``chat(messages, ...)`` returns an empty string by default
      (callers can override ``return_value`` for synthesis tests).
    - ``rerank(query, candidates, ...)`` returns the candidates
      unchanged in order (good enough for the simple KNN path
      used in tests).
    """
    mock = MagicMock()
    # Unit vector along axis 0. Reused across calls so cosine sim
    # between any two embed() calls is exactly 1.0.
    unit_vec = np.zeros(VECTOR_DIM, dtype=np.float32)
    unit_vec[0] = 1.0
    mock.embed = MagicMock(return_value=unit_vec.tolist())
    mock.chat = MagicMock(return_value="")
    mock.rerank = MagicMock(side_effect=lambda query, candidates, **kw: list(candidates))
    return mock


# ─── assemble() tests ─────────────────────────────────────────────


def test_assemble_with_empty_cluster_returns_empty_context():
    """``assemble()`` on a nonexistent cluster returns ``RAGContext``
    with all default-empty lists — no exception, no implicit fallback."""
    path = _make_temp_db()
    try:
        _seed_full_schema(path)
        engine = RAGEngine(db_path=path, lm_client=_mock_lm_client())
        ctx = engine.assemble("nonexistent_cluster_id")
        assert isinstance(ctx, RAGContext)
        assert ctx.cluster_id == "nonexistent_cluster_id"
        assert ctx.cluster_articles == []
        assert ctx.neighbor_ids == []
        assert ctx.neighbor_summaries == []
        assert ctx.top_entities == []
        assert ctx.related_entities == []
        assert ctx.bias_distribution == {}
        assert ctx.representative_text == ""
    finally:
        os.unlink(path)


def test_assemble_with_seeded_cluster_returns_cluster_articles():
    """A 3-card cluster produces a RAGContext with all 3 cards populated."""
    path = _make_temp_db()
    try:
        _seed_full_schema(path)
        _seed_cluster(path, "cl1", n_cards=3)
        engine = RAGEngine(db_path=path, lm_client=_mock_lm_client())
        ctx = engine.assemble("cl1")
        assert len(ctx.cluster_articles) == 3
        # All cards belong to the cluster (verified by their ids
        # since ``_fetch_cluster_articles``' SELECT doesn't include
        # ``cluster_id`` — the WHERE clause guarantees it).
        assert {a["id"] for a in ctx.cluster_articles} == {"c0", "c1", "c2"}
        # Bias distribution: all articles have bias_score=0 → neutral bucket.
        assert ctx.bias_distribution == {"pro": 0, "anti": 0, "neutral": 3}
        # Representative text is built from the top-3 articles by length.
        assert "Presidente Milei" in ctx.representative_text
    finally:
        os.unlink(path)


def test_assemble_finds_vector_neighbors():
    """Seeded ``news_embeddings`` rows are returned as KNN neighbors
    when their cosine similarity to the cluster's representative
    vector passes the ``KNN_MIN_SIMILARITY = 0.70`` threshold.

    Mock ``embed()`` returns a fixed unit vector; we seed the same
    vector for neighbor cards → cosine sim 1.0 → passes the
    threshold AND the token-overlap filter (titles share "presidente"
    with the cluster articles).
    """
    path = _make_temp_db()
    try:
        _seed_full_schema(path)
        _seed_cluster(path, "cl1", n_cards=3)
        # Seed embeddings for two OUT-of-cluster cards with the same
        # unit vector the mock embed() will return. They share the
        # token "presidente" with the cluster (passes token filter).
        vec = np.zeros(VECTOR_DIM, dtype=np.float32)
        vec[0] = 1.0
        _seed_embeddings(path, ["n1", "n2"], vec.tolist())
        # Add neighbor cards so the news_cards join in _knn_neighbors
        # can resolve them. They're NOT in the cluster so they
        # qualify as neighbors.
        conn = sqlite3.connect(path)
        for i, nid in enumerate(["n1", "n2"]):
            conn.execute(
                "INSERT INTO news_cards "
                "(id, cluster_id, title, summary, source_ids) "
                "VALUES (?, NULL, ?, ?, '1')",
                (
                    nid,
                    f"Presidente Milei related news {i}",
                    "Presidente Milei aparece en otra cobertura del mismo tema económico.",
                ),
            )
        conn.commit()
        conn.close()

        engine = RAGEngine(db_path=path, lm_client=_mock_lm_client())
        ctx = engine.assemble("cl1")
        # RERANK_ENABLED is True by default in core.rag. Our mock
        # rerank returns candidates in order, so neighbor_ids
        # should include both seeded neighbors.
        assert len(ctx.neighbor_ids) >= 1, (
            f"expected >=1 neighbor, got {ctx.neighbor_ids}"
        )
        assert all(nid in ("n1", "n2") for nid in ctx.neighbor_ids)
    finally:
        os.unlink(path)


def test_entity_co_occurrence_returns_neighbors():
    """Seeded entity graph surfaces co-occurrence neighbors.

    Setup:
      - Entity "Milei" (id=1) is the cluster's top entity (mentioned 3x).
      - Entity "Inflation" (id=2) co-occurs with Milei (card_count=5).
      - Entity "Caputo" (id=3) co-occurs with Milei (card_count=4).

    Expected: ``_related_entities`` returns both neighbors, sorted
    by card_count DESC. They're NOT in the top_entities list, so
    they survive the "exclude top entities" filter.
    """
    path = _make_temp_db()
    try:
        _seed_full_schema(path)
        _seed_cluster(path, "cl1", n_cards=3)
        conn = sqlite3.connect(path)
        # Insert entities.
        for eid, name in [(1, "Milei"), (2, "Inflation"), (3, "Caputo")]:
            conn.execute(
                "INSERT INTO entities (id, name, type) VALUES (?, ?, 'person')",
                (eid, name),
            )
        # Mention Milei on all 3 cluster cards (count >= 2 to pass
        # the top-entities filter).
        for i in range(3):
            conn.execute(
                "INSERT INTO entity_mentions (card_id, entity_id) "
                "VALUES (?, ?)",
                (f"c{i}", 1),
            )
        # Co-occurrences: Milei ↔ Inflation (5), Milei ↔ Caputo (4).
        # card_count >= 3 passes the strong-edge filter.
        conn.execute(
            "INSERT INTO entity_co_occurrences "
            "(entity_a_id, entity_b_id, card_count, last_seen) "
            "VALUES (1, 2, 5, '2026-06-23')"
        )
        conn.execute(
            "INSERT INTO entity_co_occurrences "
            "(entity_a_id, entity_b_id, card_count, last_seen) "
            "VALUES (1, 3, 4, '2026-06-23')"
        )
        conn.commit()
        conn.close()

        engine = RAGEngine(db_path=path, lm_client=_mock_lm_client())
        ctx = engine.assemble("cl1")

        # Top entities: Milei should appear (count=3 ≥ 2).
        top_names = [name for name, _ in ctx.top_entities]
        assert "Milei" in top_names

        # Related entities: Inflation and Caputo (both with
        # card_count >= 3). Sorted by count DESC.
        related_names = [name for name, _ in ctx.related_entities]
        assert "Inflation" in related_names
        assert "Caputo" in related_names
        # Inflation comes before Caputo because 5 > 4.
        assert related_names.index("Inflation") < related_names.index("Caputo")
    finally:
        os.unlink(path)


# ─── synthesize() tests ──────────────────────────────────────────


_VALID_LLM_JSON = json.dumps(
    {
        "neutral": {
            "titulo": "Resumen neutral del evento",
            "resumen": "El presidente anunció medidas económicas hoy en conferencia de prensa.",
        },
        "pro_gov": {
            "titulo": "Logro histórico del gobierno",
            "resumen": "Las nuevas medidas reflejan el compromiso del gobierno con la estabilidad.",
        },
        "anti_gov": {
            "titulo": "Críticas opositoras al anuncio",
            "resumen": "Opositores cuestionaron la efectividad de las nuevas medidas económicas.",
        },
    }
)


def test_synthesize_calls_lm_client_with_perspectives_prompt():
    """``synthesize()`` invokes ``LMStudioClient.chat`` exactly once
    with a 2-message list (system + user) that includes the
    perspectives prompt structure (CONTEXTO / RELACIONADO / SESGO /
    ENTIDADES / INSTRUCCIÓN sections)."""
    path = _make_temp_db()
    try:
        _seed_full_schema(path)
        _seed_cluster(path, "cl1", n_cards=3)
        mock_lm = _mock_lm_client()
        mock_lm.chat.return_value = _VALID_LLM_JSON
        engine = RAGEngine(db_path=path, lm_client=mock_lm)
        result = engine.synthesize("cl1")
        assert result is not None
        # Exactly one LLM call (the 1-pass version).
        assert mock_lm.chat.call_count == 1
        # The call's `messages` arg is the first positional arg
        # (``LMStudioClient.chat(messages, model, ...)`` — messages
        # is positional, not a kwarg).
        messages = mock_lm.chat.call_args.args[0]
        assert len(messages) == 2
        # System message is non-empty, user prompt contains CONTEXTO
        # (the section header from ``_build_user_prompt``).
        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"
        assert "CONTEXTO" in messages[1]["content"]
        assert "INSTRUCCIÓN" in messages[1]["content"]
    finally:
        os.unlink(path)


def test_synthesize_parses_json_response():
    """When the LM returns valid 3-perspective JSON, the resulting
    ``SynthesizedPerspectives`` has the expected titles + summaries
    propagated into the dataclass fields."""
    path = _make_temp_db()
    try:
        _seed_full_schema(path)
        _seed_cluster(path, "cl1", n_cards=3)
        mock_lm = _mock_lm_client()
        mock_lm.chat.return_value = _VALID_LLM_JSON
        engine = RAGEngine(db_path=path, lm_client=mock_lm)
        result = engine.synthesize("cl1")
        assert isinstance(result, SynthesizedPerspectives)
        assert result.cluster_id == "cl1"
        assert result.neutral_title == "Resumen neutral del evento"
        assert result.neutral_summary.startswith("El presidente anunció")
        assert result.pro_gov_title == "Logro histórico del gobierno"
        assert result.anti_gov_title == "Críticas opositoras al anuncio"
        assert result.model  # populated from RAGEngine.model
        assert result.latency_ms >= 0
    finally:
        os.unlink(path)


def test_synthesize_falls_back_safely_on_bad_json():
    """When the LM returns malformed JSON, ``synthesize()`` returns
    ``None`` and does NOT raise. The caller logs
    ``synth_bad_json`` and skips the cluster.

    The route layer (POST /cluster/{id}/synthesize-rag) treats
    ``None`` as ``ok=False``, so a bad LLM response gracefully
    degrades to an error response instead of a 500.
    """
    path = _make_temp_db()
    try:
        _seed_full_schema(path)
        _seed_cluster(path, "cl1", n_cards=3)
        mock_lm = _mock_lm_client()
        # Garbage that no JSON repair strategy can salvage.
        mock_lm.chat.return_value = "this is not JSON at all <<<>>>"
        engine = RAGEngine(db_path=path, lm_client=mock_lm)
        # Must not raise — synthesize() catches the parse failure
        # internally and returns None.
        result = engine.synthesize("cl1")
        assert result is None
        # The LM was still called once (we only know the parse
        # failed AFTER the response came back).
        assert mock_lm.chat.call_count == 1
    finally:
        os.unlink(path)


def test_synthesize_returns_none_for_empty_cluster():
    """A cluster with zero articles short-circuits before the LLM
    is ever called — saves a ~30s LM Studio round trip for empty
    clusters discovered during cluster_recent."""
    path = _make_temp_db()
    try:
        _seed_full_schema(path)
        mock_lm = _mock_lm_client()
        engine = RAGEngine(db_path=path, lm_client=mock_lm)
        result = engine.synthesize("empty_cluster")
        assert result is None
        # Critical: LM was never called (no point asking the LLM
        # to summarize nothing).
        assert mock_lm.chat.call_count == 0
    finally:
        os.unlink(path)
