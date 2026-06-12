---
name: akira-d1-harvest
description: Full harvest pipeline — extract via AKIRA API, write to unified akira.db. Batch processing with deduplication and location mapping.
version: 2.0.0
author: AKIRA
license: MIT
metadata:
  hermes:
    tags: [akira, news, harvest, sqlite, batch]
    related_skills: [akira-harvester, akira-cleaner, akira-analyst]
---

# AKIRA Batch Harvest Pipeline v2.0

Complete pipeline: get active RSS sources → extract via AKIRA → write to unified akira.db.

## Database

```bash
AKIRA_DB="/Users/omatic/proyectos/news/packages/akira/data/akira.db"
```

## Pipeline Script

```python
#!/usr/bin/env python3
"""AKIRA Batch Harvest v2.0 — extract via AKIRA, write to unified akira.db."""
import urllib.request, json, sqlite3, uuid, time
from urllib.parse import urlparse

AKIRA_DB = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
AKIRA_API = "http://localhost:5000/extract"

# Get active sources with RSS and location_id
conn = sqlite3.connect(AKIRA_DB)
sources = conn.execute("""
    SELECT s.id, s.name, s.url, s.rss_url, s.location_id
    FROM sources s
    WHERE s.is_active = 1
      AND s.rss_url IS NOT NULL AND s.rss_url != ''
      AND s.location_id IS NOT NULL
    ORDER BY s.fetch_count ASC
    LIMIT 100
""").fetchall()
conn.close()

print(f"Sources to harvest: {len(sources)}")

total_extracted = 0
total_ingested = 0
errors = 0
start = time.time()

for src_id, name, url, rss_url, loc_id in sources:
    try:
        # Extract via AKIRA
        data = json.dumps({"url": rss_url, "source_id": src_id}).encode()
        req = urllib.request.Request(
            AKIRA_API,
            data=data,
            headers={"Content-Type": "application/json", "User-Agent": "AKIRA-Harvester/2.0"}
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            result = json.loads(r.read())

        items = result.get("items", [])
        method = result.get("method", "?")

        if items:
            conn = sqlite3.connect(AKIRA_DB)
            ingested = 0
            for item in items:
                article_id = str(uuid.uuid5(uuid.NAMESPACE_URL, item.get("url", "")))
                title = (item.get("title") or "")[:500]
                summary = (item.get("summary") or "")[:2000]
                image = item.get("image_url")
                published = item.get("published_at")
                try:
                    conn.execute("""
                        INSERT OR IGNORE INTO news_cards
                        (id, location_id, title, summary, image_url, source_ids, published_at, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
                    """, (article_id, loc_id, title, summary, image, str(src_id), published))
                    ingested += 1
                except Exception:
                    pass
            conn.execute("""
                UPDATE sources SET fetch_count=fetch_count+1, last_fetch=datetime('now'), last_success=datetime('now'), error_count=0
                WHERE id=?
            """, (src_id,))
            conn.commit()
            conn.close()
            total_ingested += ingested
            print(f"  [{method}] {name} (loc={loc_id}): {len(items)} extracted, {ingested} ingested")
        else:
            conn = sqlite3.connect(AKIRA_DB)
            conn.execute("""
                UPDATE sources SET fetch_count=fetch_count+1, last_fetch=datetime('now'), error_count=error_count+1
                WHERE id=?
            """, (src_id,))
            conn.commit()
            conn.close()
            print(f"  [NONE] {name}: 0 items via {method}")

        total_extracted += len(items)
        time.sleep(0.5)  # Rate limit

    except Exception as e:
        errors += 1
        print(f"  [ERR] {name}: {e}")
        conn = sqlite3.connect(AKIRA_DB)
        conn.execute("""
            UPDATE sources SET fetch_count=fetch_count+1, last_fetch=datetime('now'), error_count=error_count+1
            WHERE id=?
        """, (src_id,))
        conn.commit()
        conn.close()

elapsed = time.time() - start
print(f"\nDone: {total_extracted} extracted, {total_ingested} ingested from {len(sources)} sources | {errors} errors | {elapsed:.0f}s")
```

## Verification

```bash
AKIRA_DB="/Users/omatic/proyectos/news/packages/akira/data/akira.db"
echo "Total news: $(sqlite3 "$AKIRA_DB" 'SELECT COUNT(*) FROM news_cards')"
echo "Latest: $(sqlite3 "$AKIRA_DB" 'SELECT MAX(created_at) FROM news_cards')"
sqlite3 "$AKIRA_DB" "SELECT l.name, COUNT(n.id) FROM news_cards n JOIN locations l ON n.location_id = l.id GROUP BY n.location_id ORDER BY COUNT(n.id) DESC LIMIT 10"
```

## Prerequisites

1. AKIRA running on port 5000
2. Unified akira.db with sources and locations populated
