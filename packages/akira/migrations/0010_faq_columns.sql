-- 0010_faq_columns.sql: Add FAQ-generation columns to clusters.
--
-- The FAQ generator (core/faq_generator.py) writes a JSON array of
-- {question, answer, source_count} pairs here, plus a timestamp and a
-- count for cheap queries. JSON shape:
--   [
--     {"question": "¿Cuándo se votó?", "answer": "Hoy.", "source_count": 4},
--     ...
--   ]
--
-- This mirrors packages/api/migrations/0012_faq_columns.sql (D1).

ALTER TABLE clusters ADD COLUMN faqs_json TEXT;
ALTER TABLE clusters ADD COLUMN faqs_at TEXT;
ALTER TABLE clusters ADD COLUMN faqs_count INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_clusters_faqs_at ON clusters(faqs_at);