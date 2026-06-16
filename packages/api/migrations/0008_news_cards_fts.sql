-- FTS5 virtual table for full-text search across news_cards
--
-- Required by /api/search. We use a regular (non-contentless) FTS5
-- table so the columns are stored in the index. The route queries
-- `news_cards_fts` and expects columns (id, title, summary, image_url,
-- source_name, category, published_at).
--
-- Triggers keep the index in sync with news_cards.
--
-- NOTE: After this migration runs, backfill the index for existing
-- news_cards rows by running:
--   wrangler d1 execute DB --command "INSERT INTO news_cards_fts
--   (id, title, summary, image_url, source_name, category, published_at)
--   SELECT id, title, summary, image_url, source_name, category,
--   published_at FROM news_cards"

CREATE VIRTUAL TABLE IF NOT EXISTS news_cards_fts USING fts5(
  id UNINDEXED,
  title,
  summary,
  image_url UNINDEXED,
  source_name,
  category,
  published_at UNINDEXED
);

CREATE TRIGGER IF NOT EXISTS news_cards_ai AFTER INSERT ON news_cards BEGIN
  INSERT INTO news_cards_fts (id, title, summary, image_url, source_name, category, published_at)
  VALUES (new.id, new.title, new.summary, new.image_url, new.source_name, new.category, new.published_at);
END;

CREATE TRIGGER IF NOT EXISTS news_cards_ad AFTER DELETE ON news_cards BEGIN
  DELETE FROM news_cards_fts WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS news_cards_au AFTER UPDATE ON news_cards BEGIN
  DELETE FROM news_cards_fts WHERE id = old.id;
  INSERT INTO news_cards_fts (id, title, summary, image_url, source_name, category, published_at)
  VALUES (new.id, new.title, new.summary, new.image_url, new.source_name, new.category, new.published_at);
END;
