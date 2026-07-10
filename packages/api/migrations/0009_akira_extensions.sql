-- 0009_akira_extensions.sql: Mirror AKIRA extensions to D1

-- Phase 1 (Foundation Wave) — simhash for near-duplicate detection
ALTER TABLE news_cards ADD COLUMN simhash BIGINT NOT NULL DEFAULT 0;
CREATE INDEX idx_news_simhash ON news_cards(simhash);