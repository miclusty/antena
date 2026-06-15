-- 0006_article_url.sqlite.sql
--
-- SQLite equivalent of the D1 migration
-- 0006_article_url.sql. AKIRA's local SQLite
-- (akira.db) needs the same article_url column
-- so the harvest layer can persist the per-article
-- URL when it inserts a new card.
ALTER TABLE news_cards ADD COLUMN article_url TEXT;
