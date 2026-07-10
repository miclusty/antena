-- 0007_simhash.sql: Add simhash column for near-duplicate detection
ALTER TABLE news_cards ADD COLUMN simhash BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_news_simhash ON news_cards(simhash);