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
// Tracks per-cluster metadata: which master-article perspectives
// exist (neutral_synth_at, pro_gov_synth_at, anti_gov_synth_at) and
// which model produced them (synth_model). When ALL three timestamps
// are non-null, the cluster has a complete RAG triple; the API can
// then serve "este evento tiene 3 perspectivas" in the feed.
export const clusters = sqliteTable("clusters", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  updatedAt: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
  masterArticleId: text("master_article_id"),
  neutralSynthAt: text("neutral_synth_at"),
  proGovSynthAt: text("pro_gov_synth_at"),
  antiGovSynthAt: text("anti_gov_synth_at"),
  synthModel: text("synth_model"),
});

export type Cluster = typeof clusters.$inferSelect;
export type NewCluster = typeof clusters.$inferInsert;

// ─── entities ──────────────────────────────────────────────────────
// LMWIKI-style knowledge base: people, places, organizations,
// events. Mentioned across news cards. `aliases` is a JSON array
// so "Milei", "JMilei", "el presidente" all resolve to the same row.
// Local SQLite (akira.db) holds the canonical store; D1 mirrors
// only what's needed for feed enrichment.
export const entities = sqliteTable(
  "entities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    aliases: text("aliases"),
    firstSeen: text("first_seen").notNull(),
    lastSeen: text("last_seen").notNull(),
    mentionCount: integer("mention_count").notNull().default(0),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
    updatedAt: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (t) => ({
    uniqName: uniqueIndex("uniq_entities_name").on(t.name),
    byType: index("idx_entities_type").on(t.type, t.mentionCount),
    byMentions: index("idx_entities_mentions").on(t.mentionCount),
  })
);

export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;

// ─── entity_mentions ───────────────────────────────────────────────
// Which cards mention which entities. `confidence` (0..1) is the
// LLM's self-reported confidence; useful for filtering noise from
// the LLM entity-extraction step.
export const entityMentions = sqliteTable(
  "entity_mentions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cardId: text("card_id").notNull(),
    entityId: integer("entity_id").notNull(),
    confidence: real("confidence").notNull().default(1.0),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (t) => ({
    uniqCardEntity: uniqueIndex("uniq_mentions_card_entity").on(t.cardId, t.entityId),
    byCard: index("idx_mentions_card").on(t.cardId),
    byEntity: index("idx_mentions_entity").on(t.entityId, t.confidence),
  })
);

export type EntityMention = typeof entityMentions.$inferSelect;
export type NewEntityMention = typeof entityMentions.$inferInsert;

// ─── entity_co_occurrences ─────────────────────────────────────────
// Graph edges. (entity_a_id, entity_b_id) is the unique key; we
// always store the pair with the smaller id as entity_a to
// deduplicate (a,b) and (b,a). Used by RAG to find "what else is
// mentioned alongside this entity" for richer synthesis.
export const entityCoOccurrences = sqliteTable(
  "entity_co_occurrences",
  {
    entityAId: integer("entity_a_id").notNull(),
    entityBId: integer("entity_b_id").notNull(),
    cardCount: integer("card_count").notNull().default(0),
    lastSeen: text("last_seen").notNull(),
  },
  (t) => ({
    pk: uniqueIndex("entity_co_occurrences_pk").on(t.entityAId, t.entityBId),
    byA: index("idx_coocc_a").on(t.entityAId, t.cardCount),
    byB: index("idx_coocc_b").on(t.entityBId, t.cardCount),
  })
);

export type EntityCoOccurrence = typeof entityCoOccurrences.$inferSelect;
export type NewEntityCoOccurrence = typeof entityCoOccurrences.$inferInsert;

// ─── rag_queries ────────────────────────────────────────────────────
// Audit log of RAG retrievals. Useful for offline evaluation and
// debugging bad master articles. Not queried from the feed; this is
// pure observability.
export const ragQueries = sqliteTable(
  "rag_queries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clusterId: text("cluster_id").notNull(),
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    neighborsUsed: text("neighbors_used"),
    entitiesUsed: text("entities_used"),
    perspectives: text("perspectives"),
    latencyMs: integer("latency_ms").notNull().default(0),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (t) => ({
    byCluster: index("idx_rag_cluster").on(t.clusterId, t.createdAt),
    byCreated: index("idx_rag_created").on(t.createdAt),
  })
);

export type RagQuery = typeof ragQueries.$inferSelect;
export type NewRagQuery = typeof ragQueries.$inferInsert;

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
    // Denormalized engagement counters. Updated atomically by
    // the vote/repost endpoints in routes/news.ts.
    upvotes: integer("upvotes").notNull().default(0),
    downvotes: integer("downvotes").notNull().default(0),
    reposts: integer("reposts").notNull().default(0),
    // Useful feedback (S3.5): user thumbs up/down on the article
    // view. Denormalized so the feed can show "87% found this
    // useful" without joining article_feedback.
    usefulYes: integer("useful_yes").notNull().default(0),
    usefulNo: integer("useful_no").notNull().default(0),
    // Set to 1 when at least one user has reported this article
    // (S3.6). Acts as a quick filter for the moderation queue.
    isReported: integer("is_reported", { mode: "boolean" }).notNull().default(false),
  },
  (t) => ({
    byLocation: index("idx_news_location").on(t.locationId, t.publishedAt),
    byCategory: index("idx_news_category").on(t.category, t.publishedAt),
    byCluster: index("idx_news_cluster").on(t.clusterId),
    byBias: index("idx_news_bias").on(t.biasScore),
    byPublished: index("idx_news_published").on(t.publishedAt),
    byUpvotes: index("idx_news_upvotes").on(t.upvotes, t.createdAt),
    byReposts: index("idx_news_reposts").on(t.reposts, t.createdAt),
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

// ─── News engagement: votes + reposts ───────────────────────────
// Anonymous per-device engagement signals. Same auth model as
// source_follows: device_id is a UUID generated client-side.
// (device_id, news_id) is unique for both tables — a device
// can only have one vote (1 or -1) per article, and only one
// repost. Counter updates on news_cards are the materialized
// projection of these tables.

export const newsVotes = sqliteTable(
  "news_votes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deviceId: text("device_id").notNull(),
    newsId: text("news_id").notNull(),
    vote: integer("vote").notNull(), // 1 or -1
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
    updatedAt: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (t) => ({
    byDevice: index("idx_votes_device").on(t.deviceId),
    byNews: index("idx_votes_news").on(t.newsId),
    uniquePair: uniqueIndex("uniq_votes_device_news").on(t.deviceId, t.newsId),
  })
);

export const newsReposts = sqliteTable(
  "news_reposts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deviceId: text("device_id").notNull(),
    newsId: text("news_id").notNull(),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (t) => ({
    byDevice: index("idx_reposts_device").on(t.deviceId),
    byNews: index("idx_reposts_news").on(t.newsId),
    uniquePair: uniqueIndex("uniq_reposts_device_news").on(t.deviceId, t.newsId),
  })
);

export type NewsVote = typeof newsVotes.$inferSelect;
export type NewNewsVote = typeof newsVotes.$inferInsert;
export type NewsRepost = typeof newsReposts.$inferSelect;
export type NewNewsRepost = typeof newsReposts.$inferInsert;

// ─── Article feedback + reports (S3.5 + S3.6) ───────────────────

export const articleFeedback = sqliteTable(
  "article_feedback",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deviceId: text("device_id").notNull(),
    newsId: text("news_id").notNull(),
    /** 1 = useful, 0 = not useful. CHECK constraint on the SQL side. */
    useful: integer("useful").notNull(),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
    updatedAt: text("updated_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (t) => ({
    byDevice: index("idx_feedback_device").on(t.deviceId),
    byNews: index("idx_feedback_news").on(t.newsId),
    uniquePair: uniqueIndex("uniq_feedback_device_news").on(t.deviceId, t.newsId),
  })
);

export const articleReports = sqliteTable(
  "article_reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deviceId: text("device_id").notNull(),
    newsId: text("news_id").notNull(),
    reason: text("reason").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull().default("CURRENT_TIMESTAMP"),
  },
  (t) => ({
    byNews: index("idx_reports_news").on(t.newsId),
    byCreated: index("idx_reports_created").on(t.createdAt),
  })
);

export type ArticleFeedback = typeof articleFeedback.$inferSelect;
export type NewArticleFeedback = typeof articleFeedback.$inferInsert;
export type ArticleReport = typeof articleReports.$inferSelect;
export type NewArticleReport = typeof articleReports.$inferInsert;

// ─── Table reference map (for typed query helpers) ───────────
export const tables = {
  categories,
  locations,
  sources,
  clusters,
  newsCards,
  masterArticles,
  sourceFollows,
  newsVotes,
  newsReposts,
  articleFeedback,
  articleReports,
  entities,
  entityMentions,
  entityCoOccurrences,
  ragQueries,
} as const;
