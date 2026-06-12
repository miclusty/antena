#!/usr/bin/env python3
"""
Migrate from multiple DBs to unified akira.db

Sources:
- packages/akira/data/akira.db (method learning: source_health, extraction_stats)
- packages/akira/data/locations.db (118 locations)
- .wrangler/state/v3/d1/...sqlite (D1: sources, news_cards, categories, etc.)
"""

import sqlite3
import os
import shutil
from datetime import datetime

# Paths
AKIRA_DIR = os.path.expanduser("~/proyectos/news/packages/akira")
DATA_DIR = os.path.join(AKIRA_DIR, "data")
AKIRA_DB = os.path.join(DATA_DIR, "akira.db")
LOCATIONS_DB = os.path.join(DATA_DIR, "locations.db")
D1_DB = os.path.expanduser(
    "~/proyectos/news/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/165d01d4af018b1fd055613c0171607bade8131ef1dd994b28bef950848048e1.sqlite"
)

# Backup existing akira.db if it has data
if os.path.exists(AKIRA_DB):
    test_conn = sqlite3.connect(AKIRA_DB)
    try:
        existing_data = test_conn.execute(
            "SELECT COUNT(*) FROM source_health"
        ).fetchone()[0]
        if existing_data > 0:
            backup_path = f"{AKIRA_DB}.backup.{datetime.now().strftime('%Y%m%d%H%M%S')}"
            shutil.copy(AKIRA_DB, backup_path)
            print(f"Backed up existing akira.db to {backup_path}")
    except:
        pass
    test_conn.close()

# Connect to unified DB
conn = sqlite3.connect(AKIRA_DB)

print("Creating unified schema...")

# Create all tables
conn.executescript("""
-- Method learning tables
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

CREATE TABLE IF NOT EXISTS extraction_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT,
    method TEXT,
    duration_ms INTEGER,
    items_count INTEGER,
    success INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Categories
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    icon TEXT
);

-- Locations
CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    province TEXT NOT NULL,
    country TEXT DEFAULT 'AR',
    lat REAL,
    lng REAL,
    population INTEGER,
    type TEXT DEFAULT 'city',
    parent_id INTEGER
);

-- Sources
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
    is_active BOOLEAN DEFAULT 1,
    deactivation_reason TEXT,
    last_fetch DATETIME,
    last_success DATETIME,
    fetch_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    news_count INTEGER DEFAULT 0,
    gacetilla_count INTEGER DEFAULT 0,
    avg_bias REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- News cards
CREATE TABLE IF NOT EXISTS news_cards (
    id TEXT PRIMARY KEY,
    location_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    image_url TEXT,
    bias_score REAL DEFAULT 0,
    is_gacetilla INTEGER DEFAULT 0,
    cluster_id TEXT,
    category TEXT,
    source_ids TEXT,
    published_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Raw news
CREATE TABLE IF NOT EXISTS raw_news (
    id TEXT PRIMARY KEY,
    source_id INTEGER NOT NULL,
    location_id INTEGER,
    original_url TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    summary TEXT,
    image_url TEXT,
    image_local_path TEXT,
    published_at DATETIME,
    extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending',
    error_message TEXT
);

-- Processed news
CREATE TABLE IF NOT EXISTS processed_news (
    id TEXT PRIMARY KEY,
    source_id INTEGER NOT NULL,
    location_id INTEGER,
    original_url TEXT,
    title TEXT NOT NULL,
    body TEXT,
    summary TEXT,
    neutral_summary TEXT,
    image_url TEXT,
    image_local_path TEXT,
    bias_score REAL,
    bias_reasoning TEXT,
    is_gacetilla INTEGER DEFAULT 0,
    gacetilla_confidence REAL DEFAULT 0,
    cluster_id TEXT,
    category TEXT,
    item_count INTEGER DEFAULT 1,
    published_at DATETIME,
    analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending_clean'
);

-- Clean news
CREATE TABLE IF NOT EXISTS clean_news (
    id TEXT PRIMARY KEY,
    source_id INTEGER NOT NULL,
    location_id INTEGER,
    original_url TEXT,
    title TEXT NOT NULL,
    neutral_summary TEXT NOT NULL,
    image_url TEXT,
    image_local_path TEXT,
    image_optimized_path TEXT,
    bias_score REAL,
    is_gacetilla INTEGER DEFAULT 0,
    cluster_id TEXT,
    category TEXT,
    quality_score REAL,
    source_ids TEXT,
    published_at DATETIME,
    cleaned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    synced INTEGER DEFAULT 0,
    synced_at DATETIME,
    sync_error TEXT
);

-- Metrics
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

-- Leads
CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    domain TEXT,
    province TEXT,
    city TEXT,
    status TEXT DEFAULT 'pending',
    source_file TEXT DEFAULT 'leads.json',
    processed_at DATETIME,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sources_active ON sources(is_active, last_fetch);
CREATE INDEX IF NOT EXISTS idx_sources_location ON sources(location_id);
CREATE INDEX IF NOT EXISTS idx_sources_domain ON sources(domain);
CREATE INDEX IF NOT EXISTS idx_news_location ON news_cards(location_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_category ON news_cards(category, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_cluster ON news_cards(cluster_id);
CREATE INDEX IF NOT EXISTS idx_raw_news_status ON raw_news(status, extracted_at);
CREATE INDEX IF NOT EXISTS idx_raw_news_source ON raw_news(source_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_processed_status ON processed_news(status, analyzed_at);
CREATE INDEX IF NOT EXISTS idx_processed_category ON processed_news(category);
CREATE INDEX IF NOT EXISTS idx_processed_cluster ON processed_news(cluster_id);
CREATE INDEX IF NOT EXISTS idx_clean_synced ON clean_news(synced, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_clean_location ON clean_news(location_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_skill ON metrics(skill_name, cycle_started DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
""")

conn.commit()
print("Schema created.")

# Attach D1 and migrate data
print("\nMigrating data from D1...")

if os.path.exists(D1_DB):
    conn.execute(f"ATTACH DATABASE '{D1_DB}' AS d1")

    # Categories
    conn.execute("INSERT OR IGNORE INTO categories SELECT * FROM d1.categories")
    conn.commit()
    print(
        f"  Categories: {conn.execute('SELECT COUNT(*) FROM categories').fetchone()[0]}"
    )

    # Locations (only if empty)
    if conn.execute("SELECT COUNT(*) FROM locations").fetchone()[0] == 0:
        conn.execute("INSERT OR IGNORE INTO locations SELECT * FROM d1.locations")
        conn.commit()
    print(
        f"  Locations: {conn.execute('SELECT COUNT(*) FROM locations').fetchone()[0]}"
    )

    # Sources
    conn.execute("INSERT OR IGNORE INTO sources SELECT * FROM d1.sources")
    conn.commit()
    print(f"  Sources: {conn.execute('SELECT COUNT(*) FROM sources').fetchone()[0]}")

    # News cards
    conn.execute("INSERT OR IGNORE INTO news_cards SELECT * FROM d1.news_cards")
    conn.commit()
    print(
        f"  News cards: {conn.execute('SELECT COUNT(*) FROM news_cards').fetchone()[0]}"
    )

    # Other tables
    for table in ["raw_news", "processed_news", "clean_news", "metrics", "leads"]:
        try:
            conn.execute(f"INSERT OR IGNORE INTO {table} SELECT * FROM d1.{table}")
            conn.commit()
            count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            print(f"  {table}: {count}")
        except Exception as e:
            print(f"  {table}: skipped ({e})")

    conn.execute("DETACH DATABASE d1")
else:
    print(f"  D1 DB not found at {D1_DB}")
    print("  Trying locations.db...")

    # Try locations.db instead
    if os.path.exists(LOCATIONS_DB):
        conn.execute(f"ATTACH DATABASE '{LOCATIONS_DB}' AS loc")
        conn.execute("INSERT OR IGNORE INTO locations SELECT * FROM loc.locations")
        conn.commit()
        print(
            f"  Locations (from locations.db): {conn.execute('SELECT COUNT(*) FROM locations').fetchone()[0]}"
        )
        conn.execute("DETACH DATABASE loc")

conn.close()

print("\n" + "=" * 50)
print("Migration complete!")
print(f"Unified DB: {AKIRA_DB}")

# Print summary
conn = sqlite3.connect(AKIRA_DB)
print("\nFinal counts:")
for table in [
    "categories",
    "locations",
    "sources",
    "news_cards",
    "raw_news",
    "processed_news",
    "clean_news",
    "source_health",
    "extraction_stats",
    "metrics",
    "leads",
]:
    try:
        count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {table}: {count}")
    except:
        pass
conn.close()
