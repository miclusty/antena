"""Tests for the entity graph module.

The entity graph is a queryable view over three tables — `entities`,
`entity_mentions`, `entity_co_occurrences` — that powers "entities most
mentioned this week" leaderboards, "all articles where X mentioned Y"
queries, and per-source "people this outlet covers most" leaderboards.

Tests use a temp SQLite DB with a schema snapshot of the production
tables, so we exercise the real SQL (not in-memory mocks).
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from core.entity_graph import (
    EntityGraph,
    extract_entities_regex,
)


SCHEMA_SQL = """
CREATE TABLE entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('person', 'place', 'org', 'event')),
  aliases TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  mention_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uniq_entities_name ON entities (name);
CREATE INDEX idx_entities_type ON entities (type, mention_count DESC);
CREATE INDEX idx_entities_mentions ON entities (mention_count DESC);

CREATE TABLE entity_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uniq_mentions_card_entity
  ON entity_mentions (card_id, entity_id);
CREATE INDEX idx_mentions_card ON entity_mentions (card_id);
CREATE INDEX idx_mentions_entity ON entity_mentions (entity_id, confidence DESC);

CREATE TABLE entity_co_occurrences (
  entity_a_id INTEGER NOT NULL,
  entity_b_id INTEGER NOT NULL,
  card_count INTEGER NOT NULL DEFAULT 0,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (entity_a_id, entity_b_id),
  FOREIGN KEY (entity_a_id) REFERENCES entities(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_b_id) REFERENCES entities(id) ON DELETE CASCADE
);
CREATE INDEX idx_coocc_a ON entity_co_occurrences (entity_a_id, card_count DESC);
CREATE INDEX idx_coocc_b ON entity_co_occurrences (entity_b_id, card_count DESC);
"""


@pytest.fixture
def db_path(tmp_path):
    """Create a fresh SQLite DB with the entity graph schema."""
    path = str(tmp_path / "entity_graph_test.db")
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA_SQL)
    conn.commit()
    conn.close()
    return path


@pytest.fixture
def graph(db_path):
    return EntityGraph(db_path)


def test_ensure_schema_idempotent(db_path):
    """ensure_schema creates tables on a fresh DB and is a no-op afterwards."""
    EntityGraph(db_path)  # constructor calls ensure_schema
    EntityGraph(db_path)  # second call must not raise
    with sqlite3.connect(db_path) as conn:
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
    assert "entities" in tables
    assert "entity_mentions" in tables
    assert "entity_co_occurrences" in tables


def test_build_graph_from_article_inserts_entities_mentions_cooccurrences(graph, db_path):
    """Build a graph from 1 article with 2 people + 1 place. Verify
    entities + mentions + co-occurrences all get persisted."""
    entities = {
        "personas": ["Milei", "Caputo"],
        "lugares": ["Buenos Aires"],
        "organizaciones": [],
        "eventos": [],
    }
    graph.build_graph_from_article(
        article_id="card-1",
        title="Milei con Caputo en Buenos Aires",
        body="El presidente Milei se reunió con el ministro Caputo en Buenos Aires.",
        entities=entities,
    )
    with sqlite3.connect(db_path) as conn:
        e_rows = conn.execute("SELECT name, type, mention_count FROM entities ORDER BY name").fetchall()
        m_rows = conn.execute("SELECT card_id, entity_id FROM entity_mentions ORDER BY card_id, entity_id").fetchall()
        c_rows = conn.execute("SELECT entity_a_id, entity_b_id, card_count FROM entity_co_occurrences").fetchall()

    assert ("Buenos Aires", "place", 1) in e_rows
    assert ("Caputo", "person", 1) in e_rows
    assert ("Milei", "person", 1) in e_rows
    # 3 mentions (one per entity)
    assert len(m_rows) == 3
    # C(3,2) = 3 co-occurrences (all on card-1)
    assert len(c_rows) == 3
    for (_a, _b, count) in c_rows:
        assert count == 1


def test_build_graph_idempotent_no_double_count(graph, db_path):
    """Calling build_graph_from_article twice for the same card must
    NOT double the mention_count or the co-occurrence count."""
    entities = {"personas": ["Milei", "Caputo"], "lugares": [], "organizaciones": [], "eventos": []}
    graph.build_graph_from_article("card-1", "title", "body", entities=entities)
    graph.build_graph_from_article("card-1", "title", "body", entities=entities)
    with sqlite3.connect(db_path) as conn:
        milei_count = conn.execute(
            "SELECT mention_count FROM entities WHERE name='Milei'"
        ).fetchone()[0]
        caputo_count = conn.execute(
            "SELECT mention_count FROM entities WHERE name='Caputo'"
        ).fetchone()[0]
        coocc_count = conn.execute(
            "SELECT card_count FROM entity_co_occurrences"
        ).fetchone()[0]
    assert milei_count == 1
    assert caputo_count == 1
    assert coocc_count == 1


def test_build_graph_increments_count_for_different_card(graph, db_path):
    """Mentioning the same person on a different card bumps mention_count +1."""
    entities = {"personas": ["Milei"], "lugares": [], "organizaciones": [], "eventos": []}
    graph.build_graph_from_article("card-1", "t", "b", entities=entities)
    graph.build_graph_from_article("card-2", "t", "b", entities=entities)
    with sqlite3.connect(db_path) as conn:
        c = conn.execute(
            "SELECT mention_count FROM entities WHERE name='Milei'"
        ).fetchone()[0]
    assert c == 2


def test_build_graph_empty_entities_is_noop(graph, db_path):
    """An article with no extracted entities must not crash and must not
    insert anything (avoids polluting the graph with mentionless rows)."""
    graph.build_graph_from_article(
        "card-1", "title", "body",
        entities={"personas": [], "lugares": [], "organizaciones": [], "eventos": []},
    )
    with sqlite3.connect(db_path) as conn:
        n = conn.execute("SELECT COUNT(*) FROM entity_mentions").fetchone()[0]
    assert n == 0


def test_build_graph_skips_too_short_names(graph, db_path):
    """Single-character 'names' are noise (common when the regex catches
    an initial or stray letter). They should not become entity rows."""
    entities = {"personas": ["M", "Milei"], "lugares": [], "organizaciones": [], "eventos": []}
    graph.build_graph_from_article("card-1", "t", "b", entities=entities)
    with sqlite3.connect(db_path) as conn:
        names = {r[0] for r in conn.execute("SELECT name FROM entities").fetchall()}
    assert "M" not in names
    assert "Milei" in names


def test_get_top_entities_returns_sorted_by_mention_count(graph):
    """3 articles mention Milei (3), 1 mentions Caputo (1). Top = Milei first."""
    e_milei = {"personas": ["Milei"], "lugares": [], "organizaciones": [], "eventos": []}
    e_caputo = {"personas": ["Caputo"], "lugares": [], "organizaciones": [], "eventos": []}
    graph.build_graph_from_article("c1", "t", "b", entities=e_milei)
    graph.build_graph_from_article("c2", "t", "b", entities=e_milei)
    graph.build_graph_from_article("c3", "t", "b", entities=e_milei)
    graph.build_graph_from_article("c4", "t", "b", entities=e_caputo)
    top = graph.get_top_entities(limit=10)
    assert len(top) >= 2
    assert top[0]["name"] == "Milei"
    assert top[0]["mention_count"] >= 3
    assert top[1]["name"] == "Caputo"


def test_get_top_entities_filter_by_type(graph):
    """type=person filter excludes places."""
    e = {"personas": ["Milei"], "lugares": ["Buenos Aires"], "organizaciones": [], "eventos": []}
    graph.build_graph_from_article("c1", "t", "b", entities=e)
    only_persons = graph.get_top_entities(limit=10, entity_type="person")
    only_places = graph.get_top_entities(limit=10, entity_type="place")
    assert {p["name"] for p in only_persons} == {"Milei"}
    assert {p["name"] for p in only_places} == {"Buenos Aires"}


def test_get_related_entities_returns_cooccurrence_neighbors(graph):
    """Milei and Caputo appeared together in 2 cards; Milei and
    Bullrich appeared together in 1 card. Top related for Milei should
    be Caputo (card_count=2) ahead of Bullrich."""
    e_two = {"personas": ["Milei", "Caputo"], "lugares": [], "organizaciones": [], "eventos": []}
    e_one = {"personas": ["Milei", "Bullrich"], "lugares": [], "organizaciones": [], "eventos": []}
    graph.build_graph_from_article("c1", "t", "b", entities=e_two)
    graph.build_graph_from_article("c2", "t", "b", entities=e_two)
    graph.build_graph_from_article("c3", "t", "b", entities=e_one)

    # Look up Milei's id
    milei_id = graph.search_entities("Milei")[0]["id"]
    related = graph.get_related_entities(milei_id, limit=10)
    names = [r["name"] for r in related]
    assert "Caputo" in names
    assert "Bullrich" in names
    # Caputo should be first (2 co-occurrences vs 1)
    assert names.index("Caputo") < names.index("Bullrich")


def test_search_entities_substring_matches(graph):
    """Searching 'mile' matches 'Milei' (case-insensitive substring)."""
    e = {"personas": ["Milei", "Caputo"], "lugares": [], "organizaciones": [], "eventos": []}
    graph.build_graph_from_article("c1", "t", "b", entities=e)
    out = graph.search_entities("mile")
    assert any(r["name"] == "Milei" for r in out)
    # Caputo should NOT match "mile"
    assert not any(r["name"] == "Caputo" for r in out)


def test_get_entity_timeline_returns_daily_counts(graph):
    """Backfill entity_mentions.created_at for several days, verify the
    timeline returns one entry per day with the right counts."""
    e = {"personas": ["Milei"], "lugares": [], "organizaciones": [], "eventos": []}
    today = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    day_minus_1 = (datetime.now(timezone.utc) - timedelta(days=1)).replace(microsecond=0).isoformat()
    day_minus_2 = (datetime.now(timezone.utc) - timedelta(days=2)).replace(microsecond=0).isoformat()
    # Insert directly with backdated timestamps (build_graph uses NOW)
    with sqlite3.connect(graph.db_path) as conn:
        # Make sure entity + mention exist
        cursor = conn.execute(
            "INSERT INTO entities (name, type, first_seen, last_seen) VALUES (?, ?, ?, ?)",
            ("Milei", "person", today, today),
        )
        eid = cursor.lastrowid
        conn.execute(
            "INSERT OR IGNORE INTO entity_mentions (card_id, entity_id, created_at) VALUES (?, ?, ?)",
            ("c-today-1", eid, today),
        )
        conn.execute(
            "INSERT OR IGNORE INTO entity_mentions (card_id, entity_id, created_at) VALUES (?, ?, ?)",
            ("c-today-2", eid, today),
        )
        conn.execute(
            "INSERT OR IGNORE INTO entity_mentions (card_id, entity_id, created_at) VALUES (?, ?, ?)",
            ("c-yest", eid, day_minus_1),
        )
        conn.execute(
            "INSERT OR IGNORE INTO entity_mentions (card_id, entity_id, created_at) VALUES (?, ?, ?)",
            ("c-day2", eid, day_minus_2),
        )
        conn.commit()

    timeline = graph.get_entity_timeline(eid, days=7)
    by_day = {t["day"]: t["count"] for t in timeline}
    today_day = today[:10]
    d1 = day_minus_1[:10]
    d2 = day_minus_2[:10]
    assert by_day.get(today_day) == 2
    assert by_day.get(d1) == 1
    assert by_day.get(d2) == 1


def test_get_entity_returns_detail_with_related(graph):
    """get_entity() returns the entity row. get_entity_detail() adds
    the top related entities in one call (used by /api/entities/:id)."""
    e = {"personas": ["Milei", "Caputo"], "lugares": [], "organizaciones": [], "eventos": []}
    graph.build_graph_from_article("c1", "t", "b", entities=e)
    milei_id = graph.search_entities("Milei")[0]["id"]
    detail = graph.get_entity_detail(milei_id)
    assert detail is not None
    assert detail["name"] == "Milei"
    assert detail["type"] == "person"
    assert isinstance(detail["related"], list)
    assert any(r["name"] == "Caputo" for r in detail["related"])


def test_get_entity_returns_none_for_missing(graph):
    assert graph.get_entity_detail(99999) is None


# ─── extract_entities_regex (used when no LLM client is provided) ────


def test_extract_entities_regex_finds_capitalized_phrases():
    """Without an LLM, we fall back to a regex that picks up
    capitalized-word runs as candidate entities. Only returns tokens
    that look like proper nouns (first letter uppercase, ≥ 2 chars)."""
    text = "El presidente Milei se reunió con el ministro Caputo en Buenos Aires."
    out = extract_entities_regex(text)
    assert "Milei" in out["personas"]
    assert "Caputo" in out["personas"]
    assert "Buenos Aires" in out["lugares"] or "Buenos Aires" in out["personas"]


def test_extract_entities_regex_empty_on_garbage():
    """No capitalized words → empty dict, not an error."""
    out = extract_entities_regex("hola mundo 1234")
    assert out["personas"] == []
    assert out["lugares"] == []
    assert out["organizaciones"] == []
    assert out["eventos"] == []


def test_build_graph_from_article_uses_regex_when_no_client(db_path):
    """When build_graph_from_article is called without an `entities`
    kwarg and without an LLM client, it falls back to the regex
    extractor. This is the codepath the harvester uses (it can't wait
    for LM Studio per article)."""
    g = EntityGraph(db_path)
    g.build_graph_from_article(
        "c1",
        "Milei con Caputo",
        "El presidente Milei se reunió con el ministro Caputo.",
    )
    with sqlite3.connect(db_path) as conn:
        names = {r[0] for r in conn.execute("SELECT name FROM entities").fetchall()}
    assert "Milei" in names
    assert "Caputo" in names
