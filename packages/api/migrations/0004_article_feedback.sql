-- ─── Article feedback & reports ──────────────────────────────────
-- Two related but distinct signals from the user:
--
-- 1. "Was this useful?" — a thumbs up/down. Counts are denormalized
--    on news_cards.useful_yes/useful_no so the feed can show
--    "% found this useful" without a join.
--
-- 2. "Report" — a per-user report with a reason. Used for moderation.
--    We don't denormalize the count (low volume, and the
--    "is_reported" flag is enough to flag articles for review).

CREATE TABLE IF NOT EXISTS article_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  news_id TEXT NOT NULL,
  useful INTEGER NOT NULL CHECK (useful IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_feedback_device_news
  ON article_feedback (device_id, news_id);
CREATE INDEX IF NOT EXISTS idx_feedback_news ON article_feedback (news_id);

CREATE TABLE IF NOT EXISTS article_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  news_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('incorrect', 'clickbait', 'duplicate', 'spam', 'other')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reports_news ON article_reports (news_id);
CREATE INDEX IF NOT EXISTS idx_reports_created ON article_reports (created_at DESC);

ALTER TABLE news_cards ADD COLUMN useful_yes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE news_cards ADD COLUMN useful_no INTEGER NOT NULL DEFAULT 0;
ALTER TABLE news_cards ADD COLUMN is_reported INTEGER NOT NULL DEFAULT 0;
