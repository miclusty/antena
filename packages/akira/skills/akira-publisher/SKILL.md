---
name: akira-publisher
description: Publishes news from akira.db. Manages image uploads via AKIRA API and marks items as synced.
version: 6.0.0
author: AKIRA
license: MIT
metadata:
  hermes:
    tags: [akira, news, argentina, publisher, sync, images]
    related_skills: [akira-cleaner, akira-supervisor]
---

# AKIRA Publisher v6.0

Publishes news from **unified akira.db**. Manages image uploads and marks items as synced.

## Architecture

```
akira.db news_cards (synced = 0, quality_score >= 0.3)
    ↓
Image upload (AKIRA API) → Mark as synced
    ↓
akira.db news_cards (synced = 1, synced_at = now)
```

## Database

```bash
AKIRA_DB="/Users/omatic/proyectos/news/packages/akira/data/akira.db"
```

## Workflow

### 1. Get Unpublished News

```python
import sqlite3
AKIRA_DB = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
conn = sqlite3.connect(AKIRA_DB)
items = conn.execute("""
    SELECT id, title, image_url, category, location_id, published_at
    FROM news_cards
    WHERE synced = 0
    AND (quality_score IS NULL OR quality_score >= 0.3)
    AND is_gacetilla = 0
    ORDER BY published_at DESC
    LIMIT 50
""").fetchall()
conn.close()
```

### 2. Download & Optimize Images

```python
import urllib.request, json

API_KEY = "akira-dev-key-change-in-production"
API_BASE = "http://localhost:8787"

if image_url and image_url.startswith('http'):
    try:
        img_req = urllib.request.Request(
            f"{API_BASE}/api/images/upload",
            data=json.dumps({"image_url": image_url, "news_id": item_id}).encode(),
            headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
            method="POST"
        )
        with urllib.request.urlopen(img_req, timeout=30) as resp:
            result = json.loads(resp.read())
            # Image uploaded to R2
    except Exception as e:
        print(f"  Image error [{item_id[:8]}]: {e}")
```

### 3. Mark as Synced

```python
conn = sqlite3.connect(AKIRA_DB)
conn.execute("""
    UPDATE news_cards 
    SET synced = 1, synced_at = datetime('now')
    WHERE id = ?
""", (item_id,))
conn.commit()
conn.close()
```

## Complete Script

```python
#!/usr/bin/env python3
"""AKIRA Publisher v6.0 - Sync news and upload images."""
import sqlite3, time, urllib.request, json, os
from datetime import datetime

AKIRA_DB = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
API_KEY = os.getenv("AKIRA_API_KEY", "akira-dev-key-change-in-production")
API_BASE = "http://localhost:8787"

conn = sqlite3.connect(AKIRA_DB)
items = conn.execute("""
    SELECT id, title, image_url, category, location_id, published_at
    FROM news_cards
    WHERE synced = 0
    AND (quality_score IS NULL OR quality_score >= 0.3)
    AND is_gacetilla = 0
    ORDER BY published_at DESC
    LIMIT 50
""").fetchall()
conn.close()

print(f"Items to publish: {len(items)}")
synced = 0
images_uploaded = 0
errors = 0
start = time.time()

for i, (item_id, title, image_url, category, location_id, published) in enumerate(items):
    try:
        # Upload image if exists
        if image_url and image_url.startswith('http'):
            try:
                img_req = urllib.request.Request(
                    f"{API_BASE}/api/images/upload",
                    data=json.dumps({"image_url": image_url, "news_id": item_id}).encode(),
                    headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
                    method="POST"
                )
                with urllib.request.urlopen(img_req, timeout=30) as resp:
                    images_uploaded += 1
            except Exception as e:
                print(f"  Image error [{item_id[:8]}]: {e}")
        
        # Mark as synced
        conn2 = sqlite3.connect(AKIRA_DB)
        conn2.execute("""
            UPDATE news_cards SET synced = 1, synced_at = datetime('now')
            WHERE id = ?
        """, (item_id,))
        conn2.commit()
        conn2.close()
        synced += 1
        
        print(f"[{i+1}/{len(items)}] {title[:50]}... synced=1")
        time.sleep(0.5)
        
    except Exception as e:
        errors += 1
        print(f"  ERR [{item_id[:8]}]: {e}")

elapsed = time.time() - start
print(json.dumps({
    "cycle_started": datetime.utcnow().isoformat() + "Z",
    "items_synced": synced,
    "images_uploaded": images_uploaded,
    "errors": errors,
    "cycle_duration_s": round(elapsed, 2)
}))
```

## Cron Schedule

```
hermes cron add --skill akira-publisher --schedule "10 */15 * * * *"
```

Note: Offset 10 seconds after Cleaner. Publishes up to 50 items per execution.
