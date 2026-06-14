// ═══════════════════════════════════════════════════════════════
// Drizzle ORM schema for Cloudflare D1 (SQLite at the edge)
// ═══════════════════════════════════════════════════════════════
// Source of truth for tables served by the AKIRA/Antena API.
// Mirrors the column shapes in `migrations/0000_initial_schema.sql`.
// Keep the SQL migration and this file in sync — the migration
// is the deployment artifact, this file is the typed API.
//
// D1 specifics:
//  - No SQLite-only features (no JSON1, no FTS-only syntax in schema)
//  - All timestamps stored as ISO-8601 TEXT in UTC
//  - Foreign keys declared but not enforced (D1 limitation)
// ═══════════════════════════════════════════════════════════════

import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// ─── categories ──────────────────────────────────────────────
export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  icon: text("icon"),
});

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

// ─── locations ───────────────────────────────────────────────
export const locations = sqliteTable(
  "locations",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    province: text("province").notNull(),
    country: text("country").notNull().default("AR"),
    lat: real("lat"),
    lng: real("lng"),
    population: integer("population"),
    type: text("type").notNull().default("city"),
    parentId: integer("parent_id"),
  },
  (t) => ({
    byType: index("idx_locations_type").on(t.type),
    byProvince: index("idx_locations_province").on(t.province),
  })
);

export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;

// ─── sources ─────────────────────────────────────────────────
export const sources = sqliteTable(
  "sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    url: text("url").notNull().unique(),
    domain: text("domain"),
    country: text("country").notNull().default("AR"),
    province: text("province"),
    locationId: integer("location_id"),
    type: text("type").notNull().default("diario"),
    rssUrl: text("rss_url"),
    wpApiUrl: text("wp_api_url"),
    sitemapUrl: text("sitemap_url"),
    extractionMethod: text("extraction_method"),
    reliabilityScore: real("reliability_score").notNull().default(0.5),
    biasScore: real("bias_score").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    deactivationReason: text("deactivation_reason"),
    lastFetch: text("last_fetch"),
    lastSuccess: text("last_success"),
    lastHarvestAt: text("last_harvest_at"),
    fetchCount: integer("fetch_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    newsCount: integer("news_count").notNull().default(0),
    gacetillaCount: integer("gacetilla_count").notNull().default(0),
    avgBias: real("avg_bias"),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
    updatedAt: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (t) => ({
    byActive: index("idx_sources_active").on(t.isActive, t.lastFetch),
    byLocation: index("idx_sources_location").on(t.locationId),
    byDomain: index("idx_sources_domain").on(t.domain),
  })
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;

// ─── clusters ────────────────────────────────────────────────
export const clusters = sqliteTable("clusters", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  updatedAt: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
  masterArticleId: text("master_article_id"),
});

export type Cluster = typeof clusters.$inferSelect;
export type NewCluster = typeof clusters.$inferInsert;

// ─── news_cards ──────────────────────────────────────────────
export const newsCards = sqliteTable(
  "news_cards",
  {
    id: text("id").primaryKey(),
    locationId: integer("location_id").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    body: text("body"),
    imageUrl: text("image_url"),
    sourceUrl: text("source_url"),
    sourceName: text("source_name"),
    sourceId: integer("source_id"),
    category: text("category"),
    biasScore: real("bias_score").notNull().default(0),
    isGacetilla: integer("is_gacetilla", { mode: "boolean" }).notNull().default(false),
    gacetillaConfidence: real("gacetilla_confidence").notNull().default(0),
    sourcesCount: integer("sources_count").notNull().default(1),
    qualityScore: real("quality_score"),
    clusterId: text("cluster_id"),
    publishedAt: text("published_at"),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (t) => ({
    byLocation: index("idx_news_location").on(t.locationId, t.publishedAt),
    byCategory: index("idx_news_category").on(t.category, t.publishedAt),
    byCluster: index("idx_news_cluster").on(t.clusterId),
    byBias: index("idx_news_bias").on(t.biasScore),
    byPublished: index("idx_news_published").on(t.publishedAt),
  })
);

export type NewsCard = typeof newsCards.$inferSelect;
export type NewNewsCard = typeof newsCards.$inferInsert;

// ─── master_articles ─────────────────────────────────────────
export const masterArticles = sqliteTable(
  "master_articles",
  {
    id: text("id").primaryKey(),
    clusterId: text("cluster_id").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    body: text("body"),
    verifiedFacts: text("verified_facts"),
    disputedClaims: text("disputed_claims"),
    officialistPerspective: text("officialist_perspective"),
    oppositionPerspective: text("opposition_perspective"),
    neutralPerspective: text("neutral_perspective"),
    sourcesCount: integer("sources_count").notNull().default(1),
    biasMin: real("bias_min"),
    biasMax: real("bias_max"),
    biasAvg: real("bias_avg"),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (t) => ({
    byCluster: index("idx_master_cluster").on(t.clusterId),
    byCreated: index("idx_master_created").on(t.createdAt),
  })
);

export type MasterArticle = typeof masterArticles.$inferSelect;
export type NewMasterArticle = typeof masterArticles.$inferInsert;

// ─── Source follows ────────────────────────────────────────────────
// Tracks which sources a user follows. Until we have real auth
// (see TECHNICAL_DEBT.md), the user is identified by an anonymous
// device_id (a UUID generated client-side and stored in
// localStorage). The (device_id, source_id) pair is unique — a
// device can only follow a source once. The followed source's
// news then shows up in the "Siguiendo" feed tab.
export const sourceFollows = sqliteTable(
  "source_follows",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deviceId: text("device_id").notNull(),
    sourceId: integer("source_id").notNull(),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (t) => ({
    byDevice: index("idx_follows_device").on(t.deviceId),
    bySource: index("idx_follows_source").on(t.sourceId),
    uniquePair: uniqueIndex("uniq_follows_device_source").on(t.deviceId, t.sourceId),
  })
);

export type SourceFollow = typeof sourceFollows.$inferSelect;
export type NewSourceFollow = typeof sourceFollows.$inferInsert;

// ─── Table reference map (for typed query helpers) ───────────
export const tables = {
  categories,
  locations,
  sources,
  clusters,
  newsCards,
  masterArticles,
  sourceFollows,
} as const;
