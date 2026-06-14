-- ═══════════════════════════════════════════════════════════════════════════
-- RAG Tables — Day 1: Knowledge base + vector store for master article synthesis
-- ═══════════════════════════════════════════════════════════════════════════
-- Adds to LOCAL SQLite (akira.db, where AKIRA runs):
--   1. entities          — Knowledge base of people, places, organizations
--   2. entity_mentions   — Which entities each card mentions (with confidence)
--   3. entity_co_occurrences — Graph edges: pairs of entities that appear together
--   4. rag_queries       — Audit log of RAG retrievals (debugging + evaluation)
--
-- See 0003b_d1_only.sql for the D1-specific ALTER statements on `clusters`.
-- We split because the local SQLite doesn't have a `clusters` table — the
-- API in D1 has it because it materializes clusters server-side. AKIRA only
-- stores cluster_id on news_cards and resolves them at query time.

-- ─── 1. entities ───────────────────────────────────────────────────────
-- The LMWIKI knowledge base. Each unique person/place/org mentioned
-- in any news card. `aliases` is a JSON array of alternate names
-- ("Milei" → ["JMilei", "Javier Milei", "el presidente"]) so the
-- LLM entity-extraction can later resolve variants to the same row.
-- `type` is one of: person | place | org | event.
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('person', 'place', 'org', 'event')),
  aliases TEXT,                  -- JSON array of strings
  first_seen TEXT NOT NULL,      -- ISO-8601, oldest card mentioning this entity
  last_seen TEXT NOT NULL,       -- ISO-8601, newest card mentioning this entity
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
-- Many-to-many: which cards mention which entities. The `confidence`
-- column is the LLM's self-reported confidence (0..1) for the
-- mention extraction — useful for filtering noise.
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
-- Graph edges. Aggregated: if cards A and B both mention entities X
-- and Y, this row's card_count = how many times that co-mention happened.
-- Used by RAG to fetch "what else is mentioned alongside this entity"
-- for richer synthesis context.
--
-- Note: we always store the pair with the smaller id as entity_a so
-- (a,b) and (b,a) deduplicate to one row. The build_kb.py script
-- enforces this ordering.
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

-- ─── 4. rag_queries ───────────────────────────────────────────────────
-- Audit log of RAG retrievals: which cluster, which LLM, how many
-- tokens in/out, what top-K neighbors were returned, what entities
-- were injected. Lets us evaluate the RAG pipeline offline and debug
-- bad master articles.
CREATE TABLE IF NOT EXISTS rag_queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id TEXT NOT NULL,
  model TEXT NOT NULL,                  -- "qwen3.5-4b"
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  neighbors_used TEXT,                  -- JSON array of card_ids
  entities_used TEXT,                   -- JSON array of entity names
  perspectives TEXT,                    -- JSON: {neutral, pro_gov, anti_gov}
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_rag_cluster ON rag_queries (cluster_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_rag_created ON rag_queries (created_at DESC);
