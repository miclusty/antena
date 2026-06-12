---
name: akira-supervisor
description: Monitors complete AKIRA pipeline. Source audit, news quality, and problem diagnosis. Uses unified akira.db.
version: 6.0.0
author: AKIRA
license: MIT
metadata:
  hermes:
    tags: [akira, news, argentina, supervisor, monitoring, audit]
    related_skills: [akira-scout, akira-harvester, akira-analyst, akira-cleaner]
---

# AKIRA Supervisor v6.0

Monitors the complete AKIRA pipeline using **unified akira.db** as single source of truth.

## Database

```bash
AKIRA_DB="/Users/omatic/proyectos/news/packages/akira/data/akira.db"
```

## Workflow

### 1. Pipeline Health Check

```python
import sqlite3
AKIRA_DB = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
conn = sqlite3.connect(AKIRA_DB)

total = conn.execute("SELECT COUNT(*) FROM news_cards").fetchone()[0]
no_bias = conn.execute("SELECT COUNT(*) FROM news_cards WHERE bias_score IS NULL").fetchone()[0]
no_quality = conn.execute("SELECT COUNT(*) FROM news_cards WHERE quality_score IS NULL").fetchone()[0]
low_quality = conn.execute("SELECT COUNT(*) FROM news_cards WHERE quality_score < 0.3").fetchone()[0]
synced = conn.execute("SELECT COUNT(*) FROM news_cards WHERE synced = 1").fetchone()[0]
pending = conn.execute("SELECT COUNT(*) FROM news_cards WHERE synced = 0 AND quality_score >= 0.3 AND is_gacetilla = 0").fetchone()[0]
gacetillas = conn.execute("SELECT COUNT(*) FROM news_cards WHERE is_gacetilla = 1").fetchone()[0]
with_cluster = conn.execute("SELECT COUNT(*) FROM news_cards WHERE cluster_id IS NOT NULL AND cluster_id != ''").fetchone()[0]

print(f"Total news_cards: {total}")
print(f"Without bias_score: {no_bias}")
print(f"Without quality_score: {no_quality}")
print(f"Low quality (<0.3): {low_quality}")
print(f"Synced: {synced}")
print(f"Pending publish: {pending}")
print(f"Gacetillas: {gacetillas}")
print(f"With cluster: {with_cluster}")
conn.close()
```

### 2. Source Health

```python
conn = sqlite3.connect(AKIRA_DB)

# Sources with high error rate
problem_sources = conn.execute("""
    SELECT id, name, url, fetch_count, error_count, last_fetch, last_success
    FROM sources
    WHERE is_active = 1
    AND fetch_count > 0
    AND (error_count * 1.0 / fetch_count) > 0.5
    ORDER BY (error_count * 1.0 / fetch_count) DESC
    LIMIT 10
""").fetchall()

# Dead sources (no fetch in 7 days)
dead_sources = conn.execute("""
    SELECT id, name, url, fetch_count, last_fetch
    FROM sources
    WHERE is_active = 1
    AND (last_fetch IS NULL OR last_fetch < datetime('now', '-7 days'))
    LIMIT 10
""").fetchall()

# Sources never fetched
never_fetched = conn.execute("""
    SELECT COUNT(*) FROM sources
    WHERE is_active = 1 AND fetch_count = 0
""").fetchone()[0]

conn.close()
```

**NOTE:** `source_ids` is TEXT (e.g., "1,3,5"), not a numeric FK. To count news per source, use LIKE:

```python
news_count = conn.execute("""
    SELECT COUNT(*) FROM news_cards
    WHERE source_ids LIKE '%' || ? || '%'
""", (str(source_id),)).fetchone()[0]
```

### 3. Quality Audit

```python
conn = sqlite3.connect(AKIRA_DB)

# Bias distribution
bias_dist = conn.execute("""
    SELECT 
        CASE 
            WHEN bias_score < -0.5 THEN 'strong_left'
            WHEN bias_score < 0.0 THEN 'mild_left'
            WHEN bias_score = 0.0 THEN 'neutral'
            WHEN bias_score < 0.5 THEN 'mild_right'
            ELSE 'strong_right'
        END as bucket,
        COUNT(*) as count
    FROM news_cards
    WHERE bias_score IS NOT NULL
    GROUP BY bucket
""").fetchall()

# Quality by category
quality_by_cat = conn.execute("""
    SELECT COALESCE(category, 'unknown'), 
           ROUND(AVG(quality_score), 2) as avg_q,
           COUNT(*) as total
    FROM news_cards
    WHERE quality_score IS NOT NULL
    GROUP BY category
    ORDER BY avg_q ASC
""").fetchall()

conn.close()
```

### 4. Generate Report

```python
#!/usr/bin/env python3
"""AKIRA Supervisor v6.0 - Pipeline monitoring report."""
import sqlite3
from datetime import datetime

AKIRA_DB = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
conn = sqlite3.connect(AKIRA_DB)

# === NEWS STATS ===
total = conn.execute("SELECT COUNT(*) FROM news_cards").fetchone()[0]
no_bias = conn.execute("SELECT COUNT(*) FROM news_cards WHERE bias_score IS NULL").fetchone()[0]
no_quality = conn.execute("SELECT COUNT(*) FROM news_cards WHERE quality_score IS NULL").fetchone()[0]
low_quality = conn.execute("SELECT COUNT(*) FROM news_cards WHERE quality_score < 0.3").fetchone()[0]
synced = conn.execute("SELECT COUNT(*) FROM news_cards WHERE synced = 1").fetchone()[0]
pending = conn.execute("SELECT COUNT(*) FROM news_cards WHERE synced = 0 AND quality_score >= 0.3 AND is_gacetilla = 0").fetchone()[0]
gacetillas = conn.execute("SELECT COUNT(*) FROM news_cards WHERE is_gacetilla = 1").fetchone()[0]
with_cluster = conn.execute("SELECT COUNT(*) FROM news_cards WHERE cluster_id IS NOT NULL AND cluster_id != ''").fetchone()[0]

# === SOURCES ===
total_sources = conn.execute("SELECT COUNT(*) FROM sources").fetchone()[0]
active_sources = conn.execute("SELECT COUNT(*) FROM sources WHERE is_active = 1").fetchone()[0]
error_sources = conn.execute("""
    SELECT COUNT(*) FROM sources 
    WHERE is_active = 1 AND fetch_count > 0 AND (error_count * 1.0 / fetch_count) > 0.5
""").fetchone()[0]
dead_sources = conn.execute("""
    SELECT COUNT(*) FROM sources 
    WHERE is_active = 1 AND (last_fetch IS NULL OR last_fetch < datetime('now', '-7 days'))
""").fetchone()[0]
never_fetched = conn.execute("SELECT COUNT(*) FROM sources WHERE is_active = 1 AND fetch_count = 0").fetchone()[0]

# === BIAS DISTRIBUTION ===
bias_data = conn.execute("""
    SELECT 
        CASE 
            WHEN bias_score < -0.5 THEN 'strong_left'
            WHEN bias_score < 0.0 THEN 'mild_left'
            WHEN bias_score = 0.0 THEN 'neutral'
            WHEN bias_score < 0.5 THEN 'mild_right'
            ELSE 'strong_right'
        END as bucket, COUNT(*) as count
    FROM news_cards WHERE bias_score IS NOT NULL
    GROUP BY bucket
""").fetchall()

# === CATEGORY QUALITY ===
cat_quality = conn.execute("""
    SELECT COALESCE(category, 'unknown'), ROUND(AVG(quality_score), 2) as avg_q, COUNT(*) as total
    FROM news_cards WHERE quality_score IS NOT NULL
    GROUP BY category ORDER BY avg_q ASC
""").fetchall()

conn.close()

# === OUTPUT ===
print(f"""
# AKIRA Pipeline Report - {datetime.now().strftime('%Y-%m-%d %H:%M')}

## Pipeline Health

### News Cards ({total} total)
| Metric | Value |
|--------|-------|
| Analyzed (bias_score set) | {total - no_bias} |
| Unanalyzed | {no_bias} |
| Quality scored | {total - no_quality} |
| Low quality (<0.3) | {low_quality} |
| With cluster | {with_cluster} |
| Published (synced) | {synced} |
| Pending publish | {pending} |
| Gacetillas | {gacetillas} |

### Sources ({active_sources}/{total_sources} active)
| Metric | Value |
|--------|-------|
| High error rate (>50%) | {error_sources} |
| Dead (>7 days no fetch) | {dead_sources} |
| Never fetched | {never_fetched} |

### Bias Distribution
""")

for bucket, count in sorted(bias_data, key=lambda x: x[0]):
    bar = "█" * (count // 10)
    print(f"| {bucket:15} | {count:5} | {bar} |")

print("\n### Quality by Category")
print("| Category | Avg Quality | Total |")
print("|----------|-------------|-------|")
for cat, avg_q, total_cat in cat_quality:
    print(f"| {cat:15} | {avg_q:11.2f} | {total_cat:5} |")

# Health score
health = 100
if no_bias > 5000: health -= 20
elif no_bias > 1000: health -= 10
if no_quality > 5000: health -= 20
elif no_quality > 1000: health -= 10
if error_sources > 10: health -= 10
if dead_sources > 50: health -= 10
if never_fetched > 100: health -= 10

print(f"\n## Overall Health Score: {health}/100")
```

## Cron Schedule

```
hermes cron add --skill akira-supervisor --schedule "30 */6 * * *"
```

Note: Runs 30 min after Scout to avoid resource contention.
