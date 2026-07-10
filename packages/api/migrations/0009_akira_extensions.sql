-- 0009_akira_extensions.sql: Mirror AKIRA extensions to D1

-- Phase 1 (Foundation Wave) — simhash for near-duplicate detection
ALTER TABLE news_cards ADD COLUMN simhash BIGINT NOT NULL DEFAULT 0;
CREATE INDEX idx_news_simhash ON news_cards(simhash);

-- Phase 2 — bias narrative columns on clusters
ALTER TABLE clusters ADD COLUMN bias_narrative TEXT;
ALTER TABLE clusters ADD COLUMN bias_key_quotes TEXT;
ALTER TABLE clusters ADD COLUMN bias_narrative_at TEXT;
ALTER TABLE clusters ADD COLUMN bias_narrative_model TEXT;
CREATE INDEX idx_clusters_narrative_at ON clusters(bias_narrative_at);