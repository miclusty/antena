"""Tests for ClusteringService — covers the O(n²) re-cluster path."""

import os
import sqlite3

import pytest

from core.clustering import ClusteringService


@pytest.fixture
def cluster_db(tmp_path):
    """Create a temp SQLite DB with the news_cards schema clustering needs."""
    db_path = str(tmp_path / "cluster_test.db")
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
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
            source_url TEXT,
            image_url TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    conn.commit()
    conn.close()
    return db_path


def _seed_cards(db_path: str, cards: list[tuple[str, str]]) -> None:
    """Seed cards with (id, title) tuples."""
    conn = sqlite3.connect(db_path)
    for cid, title in cards:
        conn.execute(
            "INSERT INTO news_cards (id, title) VALUES (?, ?)",
            (cid, title),
        )
    conn.commit()
    conn.close()


def test_cluster_news_cards_full_pull_writes_cluster_ids(cluster_db):
    """Full pull re-clusters existing cards and persists the new cluster_ids."""
    _seed_cards(
        cluster_db,
        [
            ("a", "President announces new policy on education"),
            ("b", "President announces new policy on education"),
            ("c", "Different news about weather in Buenos Aires"),
        ],
    )

    service = ClusteringService(cluster_db)
    clusters = service.cluster_news_cards(None)  # full pull, was O(n²)

    # 'a' and 'b' share the title signature → must end up in the same cluster.
    conn = sqlite3.connect(cluster_db)
    rows = conn.execute(
        "SELECT id, cluster_id FROM news_cards ORDER BY id"
    ).fetchall()
    conn.close()
    cluster_of = {r[0]: r[1] for r in rows}
    assert cluster_of["a"] is not None
    assert cluster_of["a"] == cluster_of["b"]
    assert cluster_of["c"] is not None
    assert bool(clusters)


def test_cluster_news_cards_full_pull_respects_limit_5000(cluster_db):
    """Full pull path uses LIMIT 5000 — full table is never loaded in one pass."""
    _seed_cards(cluster_db, [("a", "foo"), ("b", "bar")])
    service = ClusteringService(cluster_db)

    captured_sql: list[str] = []

    import core.clustering as _clustering_mod

    real_get_db = _clustering_mod.get_db_connection

    from db import connection as _conn_mod

    class _TracingCtx:
        def __init__(self, path):
            self._ctx = _conn_mod.get_db_connection(path)

        def __enter__(self):
            conn = self._ctx.__enter__()
            conn.set_trace_callback(
                lambda sql: (
                    captured_sql.append(sql)
                    if isinstance(sql, str) and "FROM news_cards" in sql
                    else None
                )
            )
            return conn

        def __exit__(self, *args):
            return self._ctx.__exit__(*args)

    _clustering_mod.get_db_connection = _TracingCtx  # type: ignore[assignment]
    try:
        service.cluster_news_cards(None)
    finally:
        _clustering_mod.get_db_connection = real_get_db

    assert any("LIMIT 5000" in s for s in captured_sql), (
        f"no LIMIT 5000 seen in: {captured_sql}"
    )


def test_cluster_news_cards_partial_failure_rolls_back(cluster_db):
    """If the recompute path raises, cluster_ids stay at their pre-call values.

    Before the iter-4 fix, the cluster_news_cards() full path ran two
    separate commits (clear, then write-back). An interrupt between them
    left the DB with cluster_id=NULL for every card in the cleared range.
    This test simulates a mid-flight failure and verifies the previous
    cluster_ids survive via ROLLBACK.
    """
    _seed_cards(
        cluster_db,
        [
            ("a", "Election update from province of Buenos Aires"),
            ("b", "Election update from province of Buenos Aires"),
        ],
    )
    # Pre-existing cluster_id (would be lost under a non-atomic clear).
    conn = sqlite3.connect(cluster_db)
    conn.execute("UPDATE news_cards SET cluster_id = 'pre-existing-1'")
    conn.commit()
    conn.close()

    service = ClusteringService(cluster_db)

    # Monkey-patch _compute_clusters so it blows up after the clear has
    # happened in the same transaction.
    def boom(_items):
        raise RuntimeError("simulated mid-flight crash")

    service._compute_clusters = boom  # type: ignore[method-assign]

    with pytest.raises(RuntimeError, match="simulated mid-flight crash"):
        service.cluster_news_cards(None)

    # After the exception, cluster_ids must still be `pre-existing-1`.
    conn = sqlite3.connect(cluster_db)
    rows = conn.execute(
        "SELECT id, cluster_id FROM news_cards ORDER BY id"
    ).fetchall()
    conn.close()
    assert all(r[1] == "pre-existing-1" for r in rows), (
        f"ROLLBACK failed — cluster_ids lost: {rows}"
    )


def _ensure_clusters_table(db_path: str) -> None:
    """Provision the mirror `clusters` table — same shape as migration 0010."""
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS clusters (
            id TEXT PRIMARY KEY NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            master_article_id TEXT,
            neutral_synth_at TEXT,
            pro_gov_synth_at TEXT,
            anti_gov_synth_at TEXT,
            synth_model TEXT,
            bias_narrative TEXT,
            bias_key_quotes TEXT,
            bias_narrative_at TEXT,
            bias_narrative_model TEXT,
            contradictions_json TEXT,
            contradictions_at TEXT,
            contradictions_count INTEGER DEFAULT 0
        );
        """
    )
    conn.commit()
    conn.close()


def test_cluster_news_cards_populates_clusters_mirror_table(cluster_db):
    """Re-cluster must INSERT OR IGNORE rows into the `clusters` mirror so the
    UPDATE statements in core/synthesis.py:590 (bias_narrative) and :625
    (contradictions_json) have a row to hit. Without this, those writes
    silently fail inside a try/except and the prod API returns 404 for
    every cluster.
    """
    _ensure_clusters_table(cluster_db)
    _seed_cards(
        cluster_db,
        [
            ("a", "Senate passes new tax reform bill in Buenos Aires"),
            ("b", "Senate passes new tax reform bill in Buenos Aires"),
        ],
    )

    service = ClusteringService(cluster_db)
    clusters = service.cluster_news_cards(None)

    # Pick any cluster_id from the result and verify it exists as a
    # row in the mirror table.
    assert clusters, "expected at least one cluster"
    some_cluster_id = next(iter(clusters.keys()))

    conn = sqlite3.connect(cluster_db)
    rows = conn.execute(
        "SELECT id, created_at FROM clusters WHERE id = ?",
        (some_cluster_id,),
    ).fetchall()
    conn.close()

    assert len(rows) == 1, (
        f"clusters mirror row missing for {some_cluster_id}; "
        f"clustering.py must INSERT OR IGNORE after assigning cluster_id"
    )
    assert rows[0][1], "clusters.created_at must be populated"


def test_cluster_news_cards_mirror_insert_is_idempotent(cluster_db):
    """Re-running clustering on the same cards must not duplicate rows."""
    _ensure_clusters_table(cluster_db)
    _seed_cards(
        cluster_db,
        [
            ("a", "Milei announces new economic measures for Argentina"),
            ("b", "Milei announces new economic measures for Argentina"),
        ],
    )
    service = ClusteringService(cluster_db)
    service.cluster_news_cards(None)
    service.cluster_news_cards(None)

    conn = sqlite3.connect(cluster_db)
    n_rows = conn.execute("SELECT COUNT(*) FROM clusters").fetchone()[0]
    n_unique_clusters = conn.execute(
        "SELECT COUNT(DISTINCT cluster_id) FROM news_cards WHERE cluster_id IS NOT NULL"
    ).fetchone()[0]
    conn.close()
    assert n_rows == n_unique_clusters, (
        f"expected {n_unique_clusters} cluster rows, got {n_rows} — "
        f"INSERT OR IGNORE not being used (or duplicate inserts)"
    )
    assert n_rows >= 1, "expected at least one mirror row after re-cluster"
