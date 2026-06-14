-- ─── News author / byline ────────────────────────────────────────
-- Free-text byline. NULL for articles that don't expose one
-- (most syndicated content, some wire services). The frontend
-- (S3.7) shows the byline when present and hides the row
-- otherwise — so this column is intentionally NOT NULL DEFAULT ''
-- to keep the mapper simple: missing author → empty string,
-- not NULL.

ALTER TABLE news_cards ADD COLUMN author TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_news_author ON news_cards (author) WHERE author != '';
