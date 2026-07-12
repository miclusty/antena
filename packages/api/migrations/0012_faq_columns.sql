-- 0012_faq_columns.sql: Apply FAQ-generation columns.
--
-- Follows the same journal-drift fix pattern as 0011_contradiction_columns.sql.
-- The columns were added conceptually for the AKIRA Foundation Wave but
-- never landed in D1 prod via 0009_akira_extensions.sql (which was missing
-- from the journal). This standalone migration tracks them in the Drizzle
-- journal so the deploy workflow picks them up.
--
-- The FAQ generator runs in core/faq_generator.py and writes a JSON
-- array of {question, answer, source_count} triples here.
--
-- JSON shape:
--   [
--     {"question": "¿Cuándo se votó?", "answer": "Hoy.", "source_count": 4},
--     ...
--   ]

ALTER TABLE clusters ADD COLUMN faqs_json TEXT;
ALTER TABLE clusters ADD COLUMN faqs_at TEXT;
ALTER TABLE clusters ADD COLUMN faqs_count INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_clusters_faqs_at ON clusters(faqs_at);