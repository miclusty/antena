---
name: akira-harvester
description: Extracts news from Argentine sources using AKIRA with delta extraction. Only fetches NEW items not already in seen_urls. Writes to unified akira.db.
version: 12.0.0
author: AKIRA
license: MIT
metadata:
  hermes:
    tags: [akira, news, argentina, harvester, extraction, sqlite, async, delta]
    related_skills: [akira-scout, akira-analyst, akira-cleaner]
---

# AKIRA Harvester v12.0 — Delta Extraction

Extracts news using **AKIRA** (port 5000) with **delta extraction** — only fetches items not already seen.

## Architecture

```
AKIRA Harvester (Delta)
    ↓
akira.db sources → AKIRA API (port 5000, with db_path) → delta extraction → write to news_cards
    ↓
AKIRA handles: seen_urls dedup, last_harvest_at update, method learning
```

## Database

```bash
AKIRA_DB="/Users/omatic/proyectos/news/packages/akira/data/akira.db"
```

## Key Tables

| Table | Purpose |
|-------|---------|
| `sources` | Source metadata + `last_harvest_at` |
| `news_cards` | Published news items |
| `seen_urls` | URL dedup — prevents re-fetching same URLs |
| `source_health` | Health tracking (circuit breaker, failures) |

## Workflow

### 1. Get active, healthy sources

```python
import sqlite3
AKIRA_DB = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
conn = sqlite3.connect(AKIRA_DB)
sources = conn.execute("""
    SELECT s.id, s.name, s.url, s.location_id, s.rss_url, s.last_harvest_at
    FROM sources s
    JOIN source_health h ON s.id = h.source_id
    WHERE s.is_active = 1
    AND h.is_circuit_open = 0
    AND h.consecutive_failures < 5
    AND s.error_count < 5
""").fetchall()
conn.close()
```

### 2. Extract via AKIRA API (with delta extraction)

AKIRA handles dedup internally. Just call the extract endpoint:

```bash
curl -X POST "http://localhost:5000/extract" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.eldia.com.ar/feed/", "source_id": 1}'
```

AKIRA will:
- Check `seen_urls` table for URL dedup
- Skip items already seen
- Update `last_harvest_at` on success
- Return only NEW items

### 3. Write new items to news_cards

```python
import sqlite3, uuid
conn = sqlite3.connect(AKIRA_DB)
for item in items:
    article_id = str(uuid.uuid5(uuid.NAMESPACE_URL, item['url']))
    conn.execute("""
        INSERT OR IGNORE INTO news_cards
        (id, location_id, title, summary, image_url, source_ids, bias_score, published_at, created_at, category)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, datetime('now'), NULL)
    """, (
        article_id,
        location_id,
        item.get('title', '')[:500],
        item.get('summary', '')[:1000],
        item.get('image_url'),
        str(source_id),
        item.get('published_at') or datetime.now().strftime('%Y-%m-%dT%H:%M:%S')
    ))
conn.commit()
conn.close()
```

### 4. Update source stats

```python
# On success:
conn.execute("""
    UPDATE sources SET 
        fetch_count = fetch_count + 1,
        last_fetch = datetime('now'),
        last_success = datetime('now'),
        error_count = 0
    WHERE id = ?
""", (source_id,))

# On failure:
conn.execute("""
    UPDATE sources SET 
        fetch_count = fetch_count + 1,
        last_fetch = datetime('now'),
        error_count = error_count + 1
    WHERE id = ?
""", (source_id,))
```

## Complete Script (Python Async)

```python
#!/usr/bin/env python3
"""AKIRA Harvester v12.0 - Delta extraction with domain-aware rate limiting.

Key features:
- Delta extraction: only fetches NEW items (AKIRA handles seen_urls dedup)
- MAX_CONCURRENT = 2 (AKIRA capacity limit)
- RATE_LIMIT = 2.0 per domain
- Per-request reason tracking for debugging
"""
import sqlite3, json, uuid, asyncio, aiohttp
from datetime import datetime
from urllib.parse import urlparse
from collections import defaultdict

AKIRA_DB = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
AKIRA_API = "http://localhost:5000/extract"
MAX_CONCURRENT = 2   # AKIRA capacity: ~2 concurrent before timeouts
RATE_LIMIT = 2.0     # seconds between requests per domain
TIMEOUT = 60.0       # per-request timeout

# Get active, healthy sources (JOIN source_health for accuracy)
conn = sqlite3.connect(AKIRA_DB)
sources = conn.execute("""
    SELECT s.id, s.name, s.url, s.location_id, s.rss_url
    FROM sources s
    JOIN source_health h ON s.id = h.source_id
    WHERE s.is_active = 1
    AND h.is_circuit_open = 0
    AND h.consecutive_failures < 5
    AND s.error_count < 5
""").fetchall()
conn.close()

# Group by domain for rate limiting
domains = defaultdict(list)
for source_id, name, url, location_id, rss_url in sources:
    domain = urlparse(url).netloc
    domains[domain].append((source_id, name, url, location_id, rss_url))

print(f"Total sources: {len(sources)} | Domains: {len(domains)} | Concurrency: {MAX_CONCURRENT}")

stats = {'items': 0, 'sources_with_items': 0, 'errors': 0, 'start': asyncio.get_event_loop().time()}

domain_semaphores = {d: asyncio.Semaphore(1) for d in domains}
domain_last_fetch = {d: 0.0}

async def extract_with_fallback(session, source_id, name, url, location_id, rss_url):
    domain = urlparse(url).netloc
    sem = domain_semaphores[domain]
    async with sem:
        now = asyncio.get_event_loop().time()
        wait = RATE_LIMIT - (now - domain_last_fetch[domain])
        if wait > 0:
            await asyncio.sleep(wait)
        domain_last_fetch[domain] = asyncio.get_event_loop().time()
        
        result = await fetch_url(session, url, source_id, rss_url)
        
        if result is None:
            result = await fetch_url(session, url.rstrip('/') + '/sitemap.xml', source_id, None)
        
        return (source_id, name, url, location_id, rss_url, result)

async def fetch_url(session, target_url, source_id, rss_url):
    payload = json.dumps({'url': target_url, 'source_id': source_id}).encode()
    headers = {'Content-Type': 'application/json'}
    
    try:
        async with session.post(AKIRA_API, data=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=TIMEOUT)) as resp:
            if resp.status != 200:
                return None
            result = await resp.json()
            items = result.get('items', [])
            if items or not rss_url:
                return items
            return None
    except Exception:
        return None

async def process_sources():
    connector = aiohttp.TCPConnector(limit=MAX_CONCURRENT, limit_per_host=1)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = []
        for domain, domain_sources in domains.items():
            for source_id, name, url, location_id, rss_url in domain_sources:
                extract_url = rss_url if rss_url else url.rstrip('/') + '/rss/'
                task = extract_with_fallback(session, source_id, name, extract_url, location_id, rss_url)
                tasks.append(task)
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        conn2 = sqlite3.connect(AKIRA_DB)
        for res in results:
            if isinstance(res, Exception):
                stats['errors'] += 1
                continue
            source_id, name, url, location_id, rss_url, items = res
            if items:
                stats['sources_with_items'] += 1
                stats['items'] += len(items)
                for item in items:
                    article_id = str(uuid.uuid5(uuid.NAMESPACE_URL, item.get('url', '')))
                    conn2.execute("""
                        INSERT OR IGNORE INTO news_cards
                        (id, location_id, title, summary, image_url, source_ids, bias_score, published_at, created_at, category)
                        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, datetime('now'), NULL)
                    """, (
                        article_id, location_id,
                        item.get('title', '')[:500],
                        item.get('summary', '')[:1000],
                        item.get('image_url'),
                        str(source_id),
                        item.get('published_at') or datetime.now().strftime('%Y-%m-%dT%H:%M:%S')
                    ))
                conn2.execute("""
                    UPDATE sources SET fetch_count=fetch_count+1, last_fetch=datetime('now'), last_success=datetime('now'), error_count=0
                    WHERE id=?
                """, (source_id,))
            else:
                conn2.execute("""
                    UPDATE sources SET fetch_count=fetch_count+1, last_fetch=datetime('now'), error_count=error_count+1
                    WHERE id=?
                """, (source_id,))
        conn2.commit()
        conn2.close()

asyncio.run(process_sources())

elapsed = asyncio.get_event_loop().time() - stats['start']
print(f"Done: {stats['sources_with_items']}/{len(sources)} sources | {stats['items']} articles | {stats['errors']} errors | {elapsed:.0f}s")
```

## Pre-flight Check

```bash
# Verify AKIRA running
curl -s http://localhost:5000/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('AKIRA:', d['status'])"

# Verify DB accessible
python3 -c "import sqlite3; c=sqlite3.connect('/Users/omatic/proyectos/news/packages/akira/data/akira.db'); print('Sources:', c.execute('SELECT COUNT(*) FROM sources WHERE is_active=1').fetchone()[0])"

# Verify seen_urls table exists
python3 -c "import sqlite3; c=sqlite3.connect('/Users/omatic/proyectos/news/packages/akira/data/akira.db'); print('Seen URLs:', c.execute('SELECT COUNT(*) FROM seen_urls').fetchone()[0])"
```

## Success Metrics

- Sources with at least 1 item: > 60%
- Items per source (avg): > 5
- Network errors: < 5%
- Total time for ~900 sources: ~3-5 min (async + parallel + domain grouping)
- **Delta benefit**: Only new items fetched, not duplicates

## Cron Schedule

```
hermes cron add --skill akira-harvester --schedule "*/30 * * * *"
```

## Verification (Post-Run)

After execution, verify the harvester actually collected new articles:

```bash
# Check new items in last run
python3 -c "
import sqlite3
from datetime import datetime, timedelta
AKIRA_DB = '/Users/omatic/proyectos/news/packages/akira/data/akira.db'
conn = sqlite3.connect(AKIRA_DB)
recent = conn.execute(\"\"\"
    SELECT COUNT(*) FROM news_cards
    WHERE created_at >= datetime('now', '-5 minutes')
\"\"\").fetchone()[0]
total = conn.execute('SELECT COUNT(*) FROM news_cards').fetchone()[0]
print(f'New articles (last 5 min): {recent}')
print(f'Total articles in DB: {total}')

# Sources that got items
active = conn.execute(\"\"\"
    SELECT COUNT(DISTINCT source_ids) FROM news_cards
    WHERE created_at >= datetime('now', '-5 minutes')
\"\"\").fetchone()[0]
print(f'Sources with new items: {active}')

# Health check
circuit_open = conn.execute('SELECT COUNT(*) FROM source_health WHERE is_circuit_open=1').fetchone()[0]
print(f'Sources with circuit open: {circuit_open}')
conn.close()
"

# Verify extraction actually happened
LAST_RUN=$(python3 -c "import sqlite3; c=sqlite3.connect('$AKIRA_DB'); print(c.execute(\"SELECT MAX(created_at) FROM news_cards\").fetchone()[0])")
if [ -z "$LAST_RUN" ]; then
  echo "WARNING: No articles in news_cards — harvest may have failed"
else
  echo "Last article inserted: $LAST_RUN"
fi
```

**If verification fails:**
- Check `curl -s http://localhost:5000/health` — is AKIRA still running?
- Check source errors: `sqlite3 "$AKIRA_DB" "SELECT name, error_count FROM sources WHERE error_count > 0"`
- Check circuit breakers: `sqlite3 "$AKIRA_DB" "SELECT name FROM sources s JOIN source_health h ON s.id=h.source_id WHERE h.is_circuit_open=1"`
