-- 0011_contradiction_columns.sql: Apply contradiction detection columns
-- that were added to 0009_akira_extensions.sql but the journal was out
-- of sync so the columns never landed in D1 prod.

ALTER TABLE clusters ADD COLUMN contradictions_json TEXT;
ALTER TABLE clusters ADD COLUMN contradictions_at TEXT;
ALTER TABLE clusters ADD COLUMN contradictions_count INTEGER DEFAULT 0;
CREATE INDEX idx_clusters_contradictions_at ON clusters(contradictions_at);