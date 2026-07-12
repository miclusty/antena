-- 0010_clusters.sql: Provision the `clusters` mirror table in AKIRA SQLite.
--
-- Until now, AKIRA's local SQLite (data/akira.db) had NO `clusters` table.
-- The synthesis pipeline (core/synthesis.py:590, :625) attempts to UPDATE
-- clusters.bias_narrative and clusters.contradictions_json — those writes
-- silently fail inside a try/except because the table doesn't exist.
--
-- This migration mirrors the D1 clusters schema exactly:
--   - 0000_initial_schema.sql: id, created_at, updated_at, master_article_id
--   - 0003b_d1_clusters.sql: neutral/pro_gov/anti_gov synth_at + synth_model
--   - 0009_akira_extensions.sql: bias_narrative + bias_key_quotes +
--     bias_narrative_at + bias_narrative_model
--   - 0011_contradiction_columns.sql: contradictions_json + contradictions_at
--     + contradictions_count
--
-- Populated by core/clustering.py (INSERT OR IGNORE when cluster_id gets
-- assigned to a news_card) and synced to D1 via core/d1_sync.py.
--
-- All columns are NULLABLE except id + created_at + updated_at, mirroring
-- the D1 schema. AKIRA-only writes: bias_narrative_at, contradictions_at.
-- AKIRA-only reads: master_article_id, synth_at, synth_model (written by
-- the API/RAG pass on D1, read by /api/clusters/:id).

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

CREATE INDEX IF NOT EXISTS idx_clusters_narrative_at
    ON clusters(bias_narrative_at);
CREATE INDEX IF NOT EXISTS idx_clusters_contradictions_at
    ON clusters(contradictions_at);
CREATE INDEX IF NOT EXISTS idx_clusters_updated
    ON clusters(updated_at);