-- Unified Schema for AKIRA v4.0
-- Compatible with both local SQLite and Cloudflare D1

-- CATEGORIES
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  icon TEXT
);

-- LOCATIONS
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  province TEXT NOT NULL,
  country TEXT DEFAULT 'AR',
  lat REAL,
  lng REAL,
  population INTEGER,
  type TEXT DEFAULT 'city',
  parent_id INTEGER,
  FOREIGN KEY (parent_id) REFERENCES locations(id)
);
CREATE INDEX IF NOT EXISTS idx_locations_type ON locations(type);
CREATE INDEX IF NOT EXISTS idx_locations_province ON locations(province);

-- SOURCES
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  domain TEXT,
  location_id INTEGER,
  province TEXT,
  type TEXT DEFAULT 'diario',
  rss_url TEXT,
  wp_api_url TEXT,
  sitemap_url TEXT,
  extraction_method TEXT,
  reliability_score REAL DEFAULT 0.5,
  is_active INTEGER DEFAULT 1,
  deactivation_reason TEXT,
  last_fetch DATETIME,
  last_success DATETIME,
  last_harvest_at DATETIME,
  fetch_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  news_count INTEGER DEFAULT 0,
  gacetilla_count INTEGER DEFAULT 0,
  avg_bias REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (location_id) REFERENCES locations(id)
);
CREATE INDEX IF NOT EXISTS idx_sources_active ON sources(is_active, last_fetch);
CREATE INDEX IF NOT EXISTS idx_sources_location ON sources(location_id);
CREATE INDEX IF NOT EXISTS idx_sources_domain ON sources(domain);

-- SEEN_URLS (delta extraction dedup)
CREATE TABLE IF NOT EXISTS seen_urls (
  url TEXT PRIMARY KEY,
  source_id INTEGER,
  first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  view_count INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_seen_urls_source ON seen_urls(source_id);
CREATE INDEX IF NOT EXISTS idx_seen_urls_last_seen ON seen_urls(last_seen);

-- SOURCE_HEALTH (method learning + circuit breaker)
CREATE TABLE IF NOT EXISTS source_health (
  source_id INTEGER PRIMARY KEY,
  url TEXT UNIQUE,
  last_success_method TEXT,
  success_count TEXT DEFAULT '{}',
  consecutive_failures INTEGER DEFAULT 0,
  is_circuit_open INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_source_health_circuit ON source_health(is_circuit_open);

-- EXTRACTION_STATS (method performance tracking)
CREATE TABLE IF NOT EXISTS extraction_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT,
  method TEXT,
  duration_ms INTEGER,
  items_count INTEGER,
  success INTEGER,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_extraction_stats_timestamp ON extraction_stats(timestamp);
CREATE INDEX IF NOT EXISTS idx_extraction_stats_method ON extraction_stats(method);

-- NEWS_CARDS (public facing news)
CREATE TABLE IF NOT EXISTS news_cards (
  id TEXT PRIMARY KEY,
  location_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  image_url TEXT,
  bias_score REAL DEFAULT 0,
  is_gacetilla INTEGER DEFAULT 0,
  gacetilla_confidence REAL DEFAULT 0,
  cluster_id TEXT,
  category TEXT,
  source_ids TEXT,
  published_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  body TEXT,
  FOREIGN KEY (location_id) REFERENCES locations(id)
);
CREATE INDEX IF NOT EXISTS idx_news_location ON news_cards(location_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_category ON news_cards(category, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_cluster ON news_cards(cluster_id);
CREATE INDEX IF NOT EXISTS idx_news_bias ON news_cards(bias_score);
CREATE INDEX IF NOT EXISTS idx_news_published ON news_cards(published_at DESC);

-- MASTER_ARTICLES (synthesized neutral articles)
CREATE TABLE IF NOT EXISTS master_articles (
  id TEXT PRIMARY KEY,
  cluster_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  verified_facts TEXT,
  disputed_claims TEXT,
  officialist_perspective TEXT,
  opposition_perspective TEXT,
  neutral_perspective TEXT,
  sources_count INTEGER,
  bias_min REAL,
  bias_max REAL,
  bias_avg REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_master_cluster ON master_articles(cluster_id);
CREATE INDEX IF NOT EXISTS idx_master_created ON master_articles(created_at DESC);

-- METRICS (pipeline execution tracking)
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_name TEXT NOT NULL,
  cycle_started DATETIME NOT NULL,
  cycle_ended DATETIME,
  duration_ms INTEGER,
  status TEXT DEFAULT 'success',
  items_processed INTEGER DEFAULT 0,
  items_success INTEGER DEFAULT 0,
  items_failed INTEGER DEFAULT 0,
  error_message TEXT,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_metrics_skill ON metrics(skill_name, cycle_started DESC);
