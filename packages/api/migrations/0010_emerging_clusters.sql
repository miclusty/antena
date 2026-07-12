-- 0010_emerging_clusters.sql: emerging clusters table for D1 (Cloudflare).
--
-- Replaces the cross-cutting extension proposal in 0009_akira_extensions.sql
-- as a stand-alone migration. 0009 was already deployed to production before
-- this feature shipped, so we add it as a new file rather than touching it.
--
-- Populated by the AKIRA cron job scripts/update_emerging_themes.py
-- (cron_restart: */15 * * * * in ecosystem.config.cjs). Computed on the
-- fly by /api/emerging; this table is the materialized cache so we can
-- serve from the cold D1 edge quickly without re-running the SQL aggregation
-- on every request.
--
-- Read pattern: SELECT … FROM emerging_clusters WHERE velocity_score >= ?
--                ORDER BY velocity_score DESC LIMIT ? — covered by
--                idx_emerging_velocity.

CREATE TABLE `emerging_clusters` (
  `cluster_id` text PRIMARY KEY NOT NULL,
  `velocity_score` real DEFAULT 0,
  `new_articles_in_window` integer DEFAULT 0,
  `distinct_sources_in_window` integer DEFAULT 0,
  `credibility_avg` real DEFAULT 0,
  `title` text,
  `first_seen_at` text,
  `last_updated_at` text DEFAULT (datetime('now')) NOT NULL
);

CREATE INDEX `idx_emerging_velocity` ON `emerging_clusters` (`velocity_score` DESC);
CREATE INDEX `idx_emerging_updated` ON `emerging_clusters` (`last_updated_at`);
