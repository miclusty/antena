#!/usr/bin/env python3
"""PULSO Harvester v4 - Fixed async extraction with domain-aware rate limiting."""
import sqlite3, json, uuid, asyncio, aiohttp, time
from datetime import datetime
from urllib.parse import urlparse
from collections import defaultdict

DB_PATH = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
API = "http://localhost:5050/extract"
MAX_CONCURRENT = 4    # Reduced: AKIRA gets swamped with 8 concurrent requests
RATE_LIMIT = 3.0      # More conservative: 3s between requests to same domain
TIMEOUT = 60.0        # Much longer: sites that return 1 jina item within 60s still work

conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA busy_timeout = 30000")
sources = conn.execute("""
    SELECT id, name, url, location_id, rss_url 
    FROM sources 
    WHERE is_active = 1
    AND rss_url IS NOT NULL AND rss_url != ''
""").fetchall()
conn.close()

domains = defaultdict(list)
for source_id, name, url, location_id, rss_url in sources:
    domain = urlparse(url).netloc
    domains[domain].append((source_id, name, url, location_id, rss_url))

print(f"Total sources: {len(sources)} | Domains: {len(domains)} | Concurrency: {MAX_CONCURRENT}", flush=True)

stats = {'items': 0, 'sources_with_items': 0, 'errors': 0, 'no_items': 0, 'start': time.time()}
domain_semaphores = {d: asyncio.Semaphore(1) for d in domains}
domain_last_fetch = {d: 0.0 for d in domains}

async def fetch_url(session, target_url, source_id):
    """Returns (items, method, error_str)"""
    try:
        payload = json.dumps({'url': target_url, 'source_id': source_id}).encode()
        headers = {'Content-Type': 'application/json'}
        async with session.post(API, data=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=TIMEOUT)) as resp:
            if resp.status != 200:
                return ([], None, f"HTTP {resp.status}")
            result = await resp.json()
            items = result.get('items', [])
            method = result.get('method')
            error = result.get('error')
            if error:
                return ([], method, f"api_error: {error}")
            return (items, method, None)
    except asyncio.TimeoutError:
        return ([], None, "timeout")
    except Exception as e:
        return ([], None, f"{type(e).__name__}")

async def extract_source(session, source_id, name, url, location_id, rss_url):
    domain = urlparse(url).netloc
    sem = domain_semaphores[domain]
    async with sem:
        wait = RATE_LIMIT - (time.time() - domain_last_fetch[domain])
        if wait > 0:
            await asyncio.sleep(wait)
        domain_last_fetch[domain] = time.time()

        # Try candidates: explicit rss_url > /feed/ > /rss/ > /sitemap.xml
        base = url.rstrip('/')
        candidates = []
        if rss_url:
            candidates.append(('rss', rss_url))
        else:
            candidates.append(('feed', f'{base}/feed/'))
            candidates.append(('rss', f'{base}/rss/'))
            candidates.append(('sitemap', f'{base}/sitemap.xml'))

        best_items = []
        best_method = None
        last_error = None

        for label, candidate_url in candidates:
            items, method, err = await fetch_url(session, candidate_url, source_id)
            if err:
                last_error = err
                if err == "timeout" and label in ('feed', 'rss'):
                    # Timeout on primary feed - still try next candidate
                    continue
                elif err == "timeout" and label == 'sitemap':
                    # Timeout on sitemap - stop trying
                    break
                else:
                    # Non-timeout error (HTTP, api_error) - stop trying
                    break
            if items and len(items) > 1 and method == 'rss':
                # Real RSS feed with multiple items - use immediately
                return (source_id, name, url, location_id, items, method, None)
            elif items and len(items) > len(best_items):
                # Keep best non-rss result as fallback
                best_items = items
                best_method = method

        if best_items:
            return (source_id, name, url, location_id, best_items, best_method, None)
        return (source_id, name, url, location_id, [], None, last_error or 'no_items')

async def run_harvest():
    connector = aiohttp.TCPConnector(limit=MAX_CONCURRENT, limit_per_host=1)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [extract_source(session, source_id, name, url, location_id, rss_url)
                 for source_id, name, url, location_id, rss_url in sources]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        conn2 = sqlite3.connect(DB_PATH)
        conn2.execute("PRAGMA busy_timeout = 30000")
        no_item_sources = []
        error_breakdown = defaultdict(int)

        for res in results:
            if isinstance(res, Exception):
                stats['errors'] += 1
                error_breakdown['exception'] += 1
                continue
            source_id, name, url, location_id, items, method, err = res
            if err:
                stats['errors'] += 1
                error_breakdown[err] += 1
                no_item_sources.append((source_id, name, err))
                conn2.execute("""
                    UPDATE sources SET fetch_count=fetch_count+1, last_fetch=datetime('now')
                    WHERE id=?
                """, (source_id,))
            elif items and len(items) > 0:
                stats['sources_with_items'] += 1
                stats['items'] += len(items)
                for item in items:
                    article_id = str(uuid.uuid4())
                    item_url = item.get('url', '')
                    title = (item.get('title') or '')[:500]
                    body = item.get('body') or ''
                    summary = item.get('summary') or ''
                    image_url = item.get('image_url')
                    published_at = item.get('published_at') or datetime.now().strftime('%Y-%m-%d %H:%M:%S')

                    conn2.execute("""
                        INSERT OR IGNORE INTO raw_news
                        (id, source_id, location_id, original_url, title, body, summary, image_url, published_at, status)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
                    """, (article_id, source_id, location_id, item_url, title, body, summary, image_url, published_at))

                conn2.execute("""
                    UPDATE sources SET fetch_count=fetch_count+1, last_fetch=datetime('now'), last_success=datetime('now')
                    WHERE id=?
                """, (source_id,))
            else:
                stats['no_items'] += 1
                no_item_sources.append((source_id, name, 'empty'))
                conn2.execute("""
                    UPDATE sources SET fetch_count=fetch_count+1, last_fetch=datetime('now')
                    WHERE id=?
                """, (source_id,))

        conn2.commit()
        conn2.close()

        # Report
        print(f"\nError breakdown:", flush=True)
        for err, count in sorted(error_breakdown.items(), key=lambda x: -x[1])[:10]:
            print(f"  {err}: {count}", flush=True)
        print(f"No-item sources: {len(no_item_sources)}", flush=True)
        if no_item_sources[:5]:
            print("Sample:", flush=True)
            for sid, name, err in no_item_sources[:5]:
                print(f"  [{sid}] {name[:35]} | {err}", flush=True)

elapsed = asyncio.run(run_harvest())

elapsed_total = time.time() - stats['start']
print(f"\nDone: {stats['sources_with_items']}/{len(sources)} sources | {stats['items']} articles | {stats['errors']} errors | {stats['no_items']} empty | {elapsed_total:.0f}s", flush=True)