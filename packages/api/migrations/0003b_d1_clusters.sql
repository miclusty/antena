-- ═══════════════════════════════════════════════════════════════════════════
-- 0003b: D1-only ALTER statements for cluster metadata
-- ═══════════════════════════════════════════════════════════════════════════
-- This file is only applied to D1 (not local akira.db). It adds the
-- columns that the API uses to know which master-article perspectives
-- exist for a given cluster, so the feed can say "este evento tiene
-- 3 perspectivas" or "todavía no se sintetizó".
--
-- Local SQLite does NOT have a `clusters` table (clusters live in D1
-- only). The base table definitions in 0003 are local-safe; this file
-- is the D1-specific part.

ALTER TABLE clusters ADD COLUMN neutral_synth_at TEXT;
--> statement-breakpoint
ALTER TABLE clusters ADD COLUMN pro_gov_synth_at TEXT;
--> statement-breakpoint
ALTER TABLE clusters ADD COLUMN anti_gov_synth_at TEXT;
--> statement-breakpoint
ALTER TABLE clusters ADD COLUMN synth_model TEXT;
