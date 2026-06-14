CREATE TABLE `source_follows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` text NOT NULL,
	`source_id` integer NOT NULL,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_follows_device` ON `source_follows` (`device_id`);--> statement-breakpoint
CREATE INDEX `idx_follows_source` ON `source_follows` (`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_follows_device_source` ON `source_follows` (`device_id`,`source_id`);
