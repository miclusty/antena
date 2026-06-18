-- 0002_media_global.sql
-- Rename argentine_media → media, add country column + nullable media metadata.

ALTER TABLE argentine_media RENAME TO media;

ALTER TABLE media ADD COLUMN country      TEXT NOT NULL DEFAULT 'AR';
ALTER TABLE media ADD COLUMN country_code TEXT;
ALTER TABLE media ADD COLUMN language     TEXT;
ALTER TABLE media ADD COLUMN bitrate      TEXT;
ALTER TABLE media ADD COLUMN codec        TEXT;

CREATE VIEW IF NOT EXISTS argentine_media AS
  SELECT * FROM media WHERE country = 'AR';

CREATE INDEX IF NOT EXISTS idx_media_country      ON media(country);
CREATE INDEX IF NOT EXISTS idx_media_country_type ON media(country, type);
CREATE INDEX IF NOT EXISTS idx_media_country_city ON media(country, city);
