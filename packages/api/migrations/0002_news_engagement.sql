-- ─── News engagement: votes + reposts ───────────────────────
-- Anonymous engagement signals keyed by device_id (same auth
-- model as source_follows). We denormalize the counts onto
-- news_cards for fast feed reads; the per-device tables are
-- the source of truth for "did THIS device vote" + idempotency.
--
-- Comments live elsewhere (S5/S7 backlog) — they need a
-- threaded UI and moderation. Votes and reposts are simple
-- counters so they ship first.

CREATE TABLE IF NOT EXISTS news_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  news_id TEXT NOT NULL,
  vote INTEGER NOT NULL CHECK (vote IN (-1, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_votes_device_news
  ON news_votes (device_id, news_id);
CREATE INDEX IF NOT EXISTS idx_votes_news ON news_votes (news_id);

CREATE TABLE IF NOT EXISTS news_reposts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  news_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_reposts_device_news
  ON news_reposts (device_id, news_id);
CREATE INDEX IF NOT EXISTS idx_reposts_news ON news_reposts (news_id);

-- Counters on news_cards. Default 0; updated by the vote/repost
-- endpoints. Kept on the same row to keep the feed query simple
-- (one SELECT, no joins needed for the count).
ALTER TABLE news_cards ADD COLUMN upvotes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE news_cards ADD COLUMN downvotes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE news_cards ADD COLUMN reposts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_news_upvotes ON news_cards (upvotes DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_reposts ON news_cards (reposts DESC, created_at DESC);
