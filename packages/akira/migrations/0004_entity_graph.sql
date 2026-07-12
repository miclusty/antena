-- ═══════════════════════════════════════════════════════════════════════════
-- Entity Graph Tables — AKIRA-local mirror of the D1 schema
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The D1 (Workers/prod) schema was created in `packages/api/migrations/
-- 0003_rag_tables.sql`. This migration creates the IDENTICAL tables in
-- AKIRA's local SQLite (data/akira.db) so the entity graph module can
-- read/write them on the AKIRA side too.
--
-- Why this matters: when the harvester extracts entities, it does so in
-- the AKIRA process. Previously this script created the tables
-- defensively (`CREATE TABLE IF NOT EXISTS`) at the top of main(). That
-- worked, but had three problems:
--   1. Schema drift risk — if 0003r changes a column, AKIRA doesn't see it
--   2. Hidden from migrations — devs running fresh clones get a
--      missing-tables runtime error
--   3. Hard to apply as part of `python -m akira migrate`
--
-- Schema is byte-identical to packages/api/migrations/0003_rag_tables.sql.
-- If you change it here, change it there too. The co_occurrences table
-- uses a composite PRIMARY KEY (no surrogate id) — same on both sides.

-- ─── 1. entities ───────────────────────────────────────────────────────
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
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uniq_entities_name ON entities (name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities (type, mention_count DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_entities_mentions ON entities (mention_count DESC);

-- ─── 2. entity_mentions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entity_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uniq_mentions_card_entity
  ON entity_mentions (card_id, entity_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_mentions_card ON entity_mentions (card_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_mentions_entity ON entity_mentions (entity_id, confidence DESC);

-- ─── 3. entity_co_occurrences ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entity_co_occurrences (
  entity_a_id INTEGER NOT NULL,
  entity_b_id INTEGER NOT NULL,
  card_count INTEGER NOT NULL DEFAULT 0,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (entity_a_id, entity_b_id),
  FOREIGN KEY (entity_a_id) REFERENCES entities(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_b_id) REFERENCES entities(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_coocc_a ON entity_co_occurrences (entity_a_id, card_count DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_coocc_b ON entity_co_occurrences (entity_b_id, card_count DESC);
