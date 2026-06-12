CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`icon` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `clusters` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`master_article_id` text
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`province` text NOT NULL,
	`country` text DEFAULT 'AR' NOT NULL,
	`lat` real,
	`lng` real,
	`population` integer,
	`type` text DEFAULT 'city' NOT NULL,
	`parent_id` integer
);
--> statement-breakpoint
CREATE INDEX `idx_locations_type` ON `locations` (`type`);--> statement-breakpoint
CREATE INDEX `idx_locations_province` ON `locations` (`province`);--> statement-breakpoint
CREATE TABLE `master_articles` (
	`id` text PRIMARY KEY NOT NULL,
	`cluster_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`body` text,
	`verified_facts` text,
	`disputed_claims` text,
	`officialist_perspective` text,
	`opposition_perspective` text,
	`neutral_perspective` text,
	`sources_count` integer DEFAULT 1 NOT NULL,
	`bias_min` real,
	`bias_max` real,
	`bias_avg` real,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_master_cluster` ON `master_articles` (`cluster_id`);--> statement-breakpoint
CREATE INDEX `idx_master_created` ON `master_articles` (`created_at`);--> statement-breakpoint
CREATE TABLE `news_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` integer NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`body` text,
	`image_url` text,
	`source_url` text,
	`source_name` text,
	`source_id` integer,
	`category` text,
	`bias_score` real DEFAULT 0 NOT NULL,
	`is_gacetilla` integer DEFAULT false NOT NULL,
	`gacetilla_confidence` real DEFAULT 0 NOT NULL,
	`sources_count` integer DEFAULT 1 NOT NULL,
	`quality_score` real,
	`cluster_id` text,
	`published_at` text,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_news_location` ON `news_cards` (`location_id`,`published_at`);--> statement-breakpoint
CREATE INDEX `idx_news_category` ON `news_cards` (`category`,`published_at`);--> statement-breakpoint
CREATE INDEX `idx_news_cluster` ON `news_cards` (`cluster_id`);--> statement-breakpoint
CREATE INDEX `idx_news_bias` ON `news_cards` (`bias_score`);--> statement-breakpoint
CREATE INDEX `idx_news_published` ON `news_cards` (`published_at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`domain` text,
	`country` text DEFAULT 'AR' NOT NULL,
	`province` text,
	`location_id` integer,
	`type` text DEFAULT 'diario' NOT NULL,
	`rss_url` text,
	`wp_api_url` text,
	`sitemap_url` text,
	`extraction_method` text,
	`reliability_score` real DEFAULT 0.5 NOT NULL,
	`bias_score` real DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`deactivation_reason` text,
	`last_fetch` text,
	`last_success` text,
	`last_harvest_at` text,
	`fetch_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`news_count` integer DEFAULT 0 NOT NULL,
	`gacetilla_count` integer DEFAULT 0 NOT NULL,
	`avg_bias` real,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_url_unique` ON `sources` (`url`);--> statement-breakpoint
CREATE INDEX `idx_sources_active` ON `sources` (`is_active`,`last_fetch`);--> statement-breakpoint
CREATE INDEX `idx_sources_location` ON `sources` (`location_id`);--> statement-breakpoint
CREATE INDEX `idx_sources_domain` ON `sources` (`domain`);