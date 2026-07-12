-- 0009_emerging_themes.sql: emerging-clusters mirror table for AKIRA SQLite.
--
-- Populated by scripts/update_emerging_themes.py every 15 minutes. The
-- API worker (Cloudflare D1) reads from its own `emerging_clusters`
-- table (0010_emerging_clusters.sql in ../api/migrations/). A future
-- sync_to_d1.py extension could copy emerging rows into D1 if the API
-- doesn't need real-time (currently the API computes on the fly).
--
-- Schema mirrors D1 verbatim: cluster_id PK, velocity_score REAL,
-- new_articles_in_window INTEGER, distinct_sources INTEGER, credibility
-- REAL, title, first_seen_at, last_updated_at.

CREATE TABLE IF NOT EXISTS emerging_clusters (
    cluster_id TEXT PRIMARY KEY,
    velocity_score REAL DEFAULT 0,
    new_articles_in_window INTEGER DEFAULT 0,
    distinct_sources_in_window INTEGER DEFAULT 0,
    credibility_avg REAL DEFAULT 0,
    title TEXT,
    first_seen_at TEXT,
    last_updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_emerging_velocity ON emerging_clusters(velocity_score DESC);
CREATE INDEX IF NOT EXISTS idx_emerging_updated ON emerging_clusters(last_updated_at);
