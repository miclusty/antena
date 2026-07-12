-- 0009_contradictions.sql: Add contradiction-detection columns to clusters.
--
-- The detector (core/contradiction_detector.py) writes a JSON array of
-- NumericalClaim disagreements here, plus a timestamp and a count for
-- cheap queries. The JSON shape:
--   [
--     {
--       "subject": "muerto",
--       "unit": null,
--       "values": [5.0, 8.0],
--       "entries": [{"source": "A", "value": 5.0, "raw_text": "..."},
--                   {"source": "B", "value": 8.0, "raw_text": "..."}],
--       "confidence": 0.85
--     },
--     ...
--   ]
--
-- Note: AKIRA SQLite does not currently have a `clusters` table — the
-- UPDATE statements in synthesis.py are caught and logged but not
-- persisted. This migration is a no-op on local SQLite until a
-- clusters table is provisioned, but is required for parity with the
-- D1 schema in packages/api/migrations/0009_akira_extensions.sql.

ALTER TABLE clusters ADD COLUMN contradictions_json TEXT;
ALTER TABLE clusters ADD COLUMN contradictions_at TEXT;
ALTER TABLE clusters ADD COLUMN contradictions_count INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_clusters_contradictions_at ON clusters(contradictions_at);