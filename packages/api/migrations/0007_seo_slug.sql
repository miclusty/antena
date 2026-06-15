-- 0007_seo_slug.sql
--
-- Add slug + slug_date columns to news_cards for SEO-friendly canonical
-- URLs (`/noticia/{slug_date}/{slug}`). Empty string default keeps
-- existing rows valid; the AKIRA engine and the backfill script
-- (scripts/backfill_slugs.py) populate both columns.
--
-- Two indexes:
--   idx_news_slug         UNIQUE (slug_date, slug) — primary lookup for
--                         the canonical URL. Composite because the same
--                         title can recur on different days.
--   idx_news_slug_lookup  (slug) — collision detection during backfill
--                         and any "find by slug" queries that don't
--                         need the date partition.
ALTER TABLE news_cards ADD COLUMN slug TEXT NOT NULL DEFAULT '';
ALTER TABLE news_cards ADD COLUMN slug_date TEXT NOT NULL DEFAULT '';
-- Partial unique index: empty slugs are transient (will be backfilled) and
-- would otherwise collide on the ('', '') pair. Once backfilled, all slugs
-- are real and the uniqueness constraint fires as expected.
CREATE UNIQUE INDEX idx_news_slug ON news_cards (slug_date, slug) WHERE slug != '';
CREATE INDEX idx_news_slug_lookup ON news_cards (slug);
