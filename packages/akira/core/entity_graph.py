"""Entity graph — queryable view over people/places/orgs mentioned across
the news corpus.

Tables this module owns (matches `packages/api/migrations/0003_rag_tables.sql`
for the D1 side and `packages/akira/migrations/0004_entity_graph.sql` for
the AKIRA-local side):

  entities              — knowledge base: one row per unique person/place/org
  entity_mentions       — many-to-many: which cards mention which entities
  entity_co_occurrences — graph edges: pairs of entities that appeared together

Used by:
  - /api/entities/top      (leaderboard: most-mentioned this week)
  - /api/entities/:id      (entity profile + co-occurrence neighbors)
  - /api/entities/:id/timeline (daily mention counts for sparkline)
  - /api/entities/search   (substring lookup by name)
  - harvest_run.py         (per-article ingest, called after each INSERT)
  - extract_entities.py    (LLM-driven batch backfill)

Idempotency:
  - entities              → UNIQUE(name) — re-mention is UPDATE +1
  - entity_mentions       → UNIQUE(card_id, entity_id) — duplicate is a no-op
  - entity_co_occurrences  → PK(a, b) + ON CONFLICT card_count+=1
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

logger = logging.getLogger("akira.entity_graph")

MIN_NAME_LEN = 2
MAX_NAME_LEN = 80

# Schema-level entity types. These match the CHECK constraint in
# the entities table (see 0003_rag_tables.sql + 0004_entity_graph.sql).
ENTITY_TYPES = ("person", "place", "org", "event")

# The LLM-extraction key→schema-type mapping. Public so callers
# (extract_entities.py) can use it to translate their own LM Studio
# JSON schema to our DB enum.
ENTITY_TYPE_MAP = {
    "personas": "person",
    "lugares": "place",
    "organizaciones": "org",
    "eventos": "event",
}

INVARIANT_STOPWORDS = {
    # Common Spanish articles/pronouns that regex picks up at sentence starts
    "El", "La", "Los", "Las", "Un", "Una", "Unos", "Unas",
    "En", "De", "Del", "Al", "A", "Y", "O", "Pero", "Sin", "Con",
    "Por", "Para", "Sobre", "Tras", "Entre",
    "The", "A", "An", "And", "Or", "But", "In", "On", "Of", "To",
    # Common headlines / known non-entity capitalized phrases
    "Argentina", "Buenos", "Aires",  # 'Buenos Aires' is multi-word; we keep it below
}
# Allow-list for multi-word places that otherwise get split
MULTI_WORD_KEEP = {
    "Buenos Aires": "place",
    "Estados Unidos": "place",
    "Reino Unido": "place",
}


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS entities (
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
CREATE UNIQUE INDEX IF NOT EXISTS uniq_entities_name ON entities (name);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities (type, mention_count DESC);
CREATE INDEX IF NOT EXISTS idx_entities_mentions ON entities (mention_count DESC);

CREATE TABLE IF NOT EXISTS entity_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_mentions_card_entity
  ON entity_mentions (card_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_mentions_card ON entity_mentions (card_id);
CREATE INDEX IF NOT EXISTS idx_mentions_entity ON entity_mentions (entity_id, confidence DESC);

CREATE TABLE IF NOT EXISTS entity_co_occurrences (
  entity_a_id INTEGER NOT NULL,
  entity_b_id INTEGER NOT NULL,
  card_count INTEGER NOT NULL DEFAULT 0,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (entity_a_id, entity_b_id),
  FOREIGN KEY (entity_a_id) REFERENCES entities(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_b_id) REFERENCES entities(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_coocc_a ON entity_co_occurrences (entity_a_id, card_count DESC);
CREATE INDEX IF NOT EXISTS idx_coocc_b ON entity_co_occurrences (entity_b_id, card_count DESC);
"""


def normalize_entity_name(name: str) -> str:
    """Canonical form for entity deduplication. We only collapse obvious
    variants here (whitespace + case trimming). Aggressive alias-merging
    (e.g. "Milei" / "Javier Milei" / "JMilei") is left to a future LLM
    pass — see the docstring on `EntityGraph.upsert_entity_aliases`."""
    return re.sub(r"\s+", " ", name).strip()


def _iso_now() -> str:
    """UTC ISO-8601 with second precision. Matches the format used
    elsewhere in AKIRA (`harvest_run._parse_date`)."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


# ─── extract_entities_regex (fallback when no LLM client is provided) ───

_CAPITALIZED_RUN_RE = re.compile(
    r"\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,3})\b"
)


def extract_entities_regex(text: str) -> Dict[str, List[str]]:
    """Lightweight entity extractor that doesn't require an LLM. Picks
    up capitalized-word runs as candidate people/places/orgs.

    Used as the fallback path:
      - In tests (we don't ship LM Studio into CI).
      - In `harvest_run.py` (the per-article insert loop can't wait 2-5s
        per article for LM Studio, so it uses this fast heuristic and
        treats results as a "noisy first pass" — the slower LM Studio
        run comes later via `extract_entities.py`).

    Returns a dict in the same shape the LLM extractor uses:
        {"personas": [...], "lugares": [...], "organizaciones": [...], "eventos": []}

    Type inference is intentionally conservative: everything goes into
    `personas` unless the name is in the well-known places dict. Promote
    with an LLM-based type-classifier when there's a real reason to.
    """
    if not text:
        return {k: [] for k in ENTITY_TYPE_MAP}

    places: List[str] = []
    persons: List[str] = []
    seen: set[str] = set()

    # Multi-word places first (greedy match for the canonical form)
    for phrase, _etype in MULTI_WORD_KEEP.items():
        if phrase.lower() in text.lower() and phrase not in seen:
            places.append(phrase)
            seen.add(phrase)

    for m in _CAPITALIZED_RUN_RE.finditer(text):
        phrase = m.group(1)
        if phrase in seen:
            continue
        # Filter noise
        words = phrase.split()
        if any(w in INVARIANT_STOPWORDS for w in words):
            continue
        if len(phrase) < MIN_NAME_LEN or len(phrase) > MAX_NAME_LEN:
            continue
        # If it matches the multi-word place list (lowercase compare), we
        # already added the canonical form above. Skip the individual words.
        canonical = phrase.lower()
        if any(canonical == mp.lower() for mp in MULTI_WORD_KEEP):
            continue
        if any(mp.lower().startswith(canonical + " ") for mp in MULTI_WORD_KEEP):
            continue
        persons.append(phrase)
        seen.add(phrase)

    return {
        "personas": persons,
        "lugares": places,
        "organizaciones": [],
        "eventos": [],
    }


# ─── EntityGraph ───────────────────────────────────────────────────────


class EntityGraph:
    """Wraps the entity/mention/co-occurrence tables. All queries go
    through this class so the SQL stays in one place."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self.ensure_schema()

    # ─── schema ───

    def ensure_schema(self) -> None:
        """Create the three tables + indexes if they don't exist.
        Idempotent — safe to call on every construction."""
        with sqlite3.connect(self.db_path) as conn:
            conn.executescript(SCHEMA_SQL)
            conn.commit()

    # ─── writers ───

    def upsert_entity(self, name: str, etype: str, conn: sqlite3.Connection) -> int:
        """Insert entity if missing; bump last_seen + mention_count if
        present. Returns the entity id.

        Note: mention_count is bumped here for new mentions — see
        `build_graph_from_article` for the full write path.
        """
        if etype not in ENTITY_TYPES:
            raise ValueError(f"invalid entity type: {etype!r}")
        now = _iso_now()
        cursor = conn.execute(
            """
            INSERT INTO entities (name, type, first_seen, last_seen)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                last_seen = excluded.last_seen,
                mention_count = mention_count + 1,
                updated_at = excluded.last_seen
            """,
            (name, etype, now, now),
        )
        # If the row already existed, the UPDATE fired and mention_count went
        # up by 1. If it was new, mention_count is still 0 and we need a
        # separate bump. Use RETURNING to detect which happened.
        # SQLite 3.35+ supports RETURNING; fall back to a SELECT otherwise.
        row = cursor.execute(
            "SELECT id, mention_count FROM entities WHERE name = ?", (name,)
        ).fetchone()
        eid, count = row
        if count == 0:
            # Brand-new row created above; bump mention_count to 1
            conn.execute(
                "UPDATE entities SET mention_count = 1 WHERE id = ?", (eid,)
            )
        return eid

    def _cooccurrence_pair(self, eid_a: int, eid_b: int) -> Tuple[int, int]:
        """Always store (smaller, larger) so (a,b) and (b,a) collide on the PK."""
        return (eid_a, eid_b) if eid_a < eid_b else (eid_b, eid_a)

    def build_graph_from_article(
        self,
        article_id: str,
        title: str,
        body: str,
        entities: Optional[Mapping[str, Sequence[str]]] = None,
    ) -> int:
        """Extract entities (or accept pre-extracted ones) and persist
        them to entities + entity_mentions + entity_co_occurrences.

        Returns the number of mention rows inserted (0 on duplicate,
        N on a fresh article with N entities).

        Two input modes:
          - `entities={"personas": [...], ...}` → use as-is. This is the
            path `extract_entities.py` uses after it calls LM Studio.
          - `entities=None` → run `extract_entities_regex()` on
            `title + " " + body`. This is the path `harvest_run.py` uses
            because it can't wait for LM Studio per article.

        Idempotent: if the same article_id is passed twice with the
        same entities, the second call is a no-op for mention_count
        and co-occurrence (the UNIQUE on (card_id, entity_id) and the
        co-occur PK both dedupe). See `commit_mentions` below.
        """
        if entities is None:
            entities = extract_entities_regex((title or "") + " " + (body or ""))
        # Normalize the shape: source keys → schema types; strings → clean names.
        flat: List[Tuple[str, str]] = []  # (canonical_name, etype)
        for src_key, etype in ENTITY_TYPE_MAP.items():
            for raw in entities.get(src_key, []) or []:
                name = normalize_entity_name(raw)
                if not name:
                    continue
                if len(name) < MIN_NAME_LEN or len(name) > MAX_NAME_LEN:
                    continue
                flat.append((name, etype))

        # Deduplicate within an article (same entity listed twice in the LLM
        # output → one mention row, not two).
        seen: set[Tuple[str, str]] = set()
        deduped: List[Tuple[str, str]] = []
        for name, etype in flat:
            key = (name, etype)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(key)
        if not deduped:
            return 0

        with sqlite3.connect(self.db_path) as conn:
            # 1) Ensure entity rows exist (no mention_count bump here — see step 2).
            eids: List[int] = []
            for name, etype in deduped:
                eid = self._ensure_entity_for_mention(conn, name, etype)
                eids.append(eid)

            # 2) Insert mentions. The UNIQUE(card_id, entity_id) makes the
            #    INSERT a no-op for re-ingested articles — we use rowcount to
            #    know which mentions were genuinely new and therefore which
            #    counts should bump.
            inserted_count = 0
            newly_inserted_eids: List[int] = []
            for eid in eids:
                cur = conn.execute(
                    """
                    INSERT OR IGNORE INTO entity_mentions
                        (card_id, entity_id, confidence) VALUES (?, ?, 1.0)
                    """,
                    (article_id, eid),
                )
                if cur.rowcount > 0:
                    inserted_count += 1
                    newly_inserted_eids.append(eid)
                    conn.execute(
                        """
                        UPDATE entities SET
                            mention_count = mention_count + 1,
                            last_seen = ?,
                            updated_at = ?
                        WHERE id = ?
                        """,
                        (_iso_now(), _iso_now(), eid),
                    )

            # 3) Co-occurrence edges. Only count pairs of NEWLY-INSERTED
            #    mentions; otherwise re-running the same article twice would
            #    double the co_count. Pairs (a,b) are stored with a<b on the
            #    composite PK so ON CONFLICT collapses correctly.
            now = _iso_now()
            for i in range(len(newly_inserted_eids)):
                for j in range(i + 1, len(newly_inserted_eids)):
                    a_id = newly_inserted_eids[i]
                    b_id = newly_inserted_eids[j]
                    a_low, b_high = self._cooccurrence_pair(a_id, b_id)
                    conn.execute(
                        """
                        INSERT INTO entity_co_occurrences
                            (entity_a_id, entity_b_id, card_count, last_seen)
                        VALUES (?, ?, 1, ?)
                        ON CONFLICT(entity_a_id, entity_b_id) DO UPDATE SET
                            card_count = card_count + 1,
                            last_seen = excluded.last_seen
                        """,
                        (a_low, b_high, now),
                    )
            conn.commit()
            return inserted_count

    def _ensure_entity_for_mention(
        self, conn: sqlite3.Connection, name: str, etype: str
    ) -> int:
        """Get-or-create the entity row. Used inside the same transaction
        as the mention insert; never bumps mention_count here (caller does)."""
        row = conn.execute(
            "SELECT id FROM entities WHERE name = ?", (name,)
        ).fetchone()
        if row:
            return row[0]
        now = _iso_now()
        cur = conn.execute(
            """
            INSERT INTO entities (name, type, first_seen, last_seen)
            VALUES (?, ?, ?, ?)
            """,
            (name, etype, now, now),
        )
        lid = cur.lastrowid
        assert lid is not None  # AUTOINCREMENT always returns an int
        return lid

    # ─── readers ───

    def get_top_entities(
        self,
        limit: int = 20,
        days: Optional[int] = None,
        entity_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Leaderboard: entities with the most mentions, optionally
        restricted to the last `days` days and/or a single type.

        `days=None` means all-time (no created_at filter).
        """
        params: List[Any] = []
        type_filter = ""
        if entity_type:
            if entity_type not in ENTITY_TYPES:
                raise ValueError(f"invalid entity_type: {entity_type!r}")
            type_filter = "WHERE e.type = ?"
            params.append(entity_type)
        if days is not None:
            glue = "AND" if entity_type else "WHERE"
            type_filter += f" {glue} em.created_at >= datetime('now', ?)"
            params.append(f"-{int(days)} day")
        sql = f"""
            SELECT e.id, e.name, e.type, e.mention_count,
                   COUNT(em.id) AS recent_count
            FROM entities e
            LEFT JOIN entity_mentions em ON em.entity_id = e.id
            {type_filter}
            GROUP BY e.id
            ORDER BY recent_count DESC, e.mention_count DESC
            LIMIT ?
        """
        params.append(limit)
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

    def get_related_entities(self, entity_id: int, limit: int = 10) -> List[Dict[str, Any]]:
        """Co-occurrence neighbors of `entity_id`, ordered by how often
        they were mentioned together. Used by the /api/entities/:id/related
        endpoint and the entity detail page."""
        sql = """
            SELECT e.id, e.name, e.type, c.card_count
            FROM entity_co_occurrences c
            JOIN entities e ON (
                e.id = CASE WHEN c.entity_a_id = ? THEN c.entity_b_id ELSE c.entity_a_id END
            )
            WHERE c.entity_a_id = ? OR c.entity_b_id = ?
            ORDER BY c.card_count DESC, c.last_seen DESC
            LIMIT ?
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(sql, (entity_id, entity_id, entity_id, limit)).fetchall()
        return [dict(r) for r in rows]

    def get_entity_timeline(
        self, entity_id: int, days: int = 30
    ) -> List[Dict[str, Any]]:
        """Daily mention counts for an entity over the last `days` days,
        suitable for a sparkline. Returns one row per day that has ≥1
        mention. Days with 0 mentions are omitted (the frontend fills gaps).
        """
        sql = """
            SELECT substr(em.created_at, 1, 10) AS day, COUNT(*) AS count
            FROM entity_mentions em
            WHERE em.entity_id = ?
              AND em.created_at >= datetime('now', ?)
            GROUP BY day
            ORDER BY day ASC
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(sql, (entity_id, f"-{int(days)} day")).fetchall()
        return [dict(r) for r in rows]

    def search_entities(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Case-insensitive substring search on entity name. Used by
        /api/entities/search?q=milei for the autocomplete.
        """
        sql = """
            SELECT id, name, type, mention_count
            FROM entities
            WHERE name LIKE ? COLLATE NOCASE
            ORDER BY mention_count DESC, name ASC
            LIMIT ?
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(sql, (f"%{query}%", limit)).fetchall()
        return [dict(r) for r in rows]

    def get_entity(self, entity_id: int) -> Optional[Dict[str, Any]]:
        """Bare entity row, or None if not found."""
        sql = """
            SELECT id, name, type, mention_count,
                   first_seen, last_seen, aliases
            FROM entities WHERE id = ?
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(sql, (entity_id,)).fetchone()
        return dict(row) if row else None

    def get_entity_detail(self, entity_id: int, related_limit: int = 10) -> Optional[Dict[str, Any]]:
        """Entity row + top related entities, returned as one payload for
        the /api/entities/:id endpoint. Saves the frontend from doing
        two roundtrips."""
        e = self.get_entity(entity_id)
        if e is None:
            return None
        e["related"] = self.get_related_entities(entity_id, limit=related_limit)
        return e
