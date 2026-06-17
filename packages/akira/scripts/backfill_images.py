#!/usr/bin/env python3
"""
Backfill news_cards.image_url by fetching the article's URL and
extracting og:image / twitter:image / first <img>.

Why: 400 of 1501 cards (26%) have NULL/empty image_url. The RSS
extractor only grabs <enclosure> and <media:thumbnail>; if the
feed doesn't include those, the card has no image. The
og:image / twitter:image meta tags almost always have an image.

This script:
  1. Selects cards with NULL/empty image_url
  2. Fetches the article's source_url
  3. Parses HTML for og:image / twitter:image / first <img>
  4. Updates news_cards.image_url

Usage:
    cd packages/akira
    source .venv/bin/activate
    python scripts/backfill_images.py [--dry-run] [--limit 100] [--workers 8]
"""
import argparse
import asyncio
import os
import re
import sqlite3
import sys
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import aiohttp

HERE = os.path.dirname(os.path.abspath(__file__))
AKIRA_ROOT = os.path.dirname(HERE)
DB_PATH = os.path.join(AKIRA_ROOT, 'data', 'akira.db')

# Patterns for image discovery, in priority order
OG_IMAGE_RE = re.compile(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', re.I)
TWITTER_IMAGE_RE = re.compile(r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']', re.I)
TWITTER_IMAGE_SRC_RE = re.compile(r'<meta[^>]+name=["\']twitter:image:src["\'][^>]+content=["\']([^"\']+)["\']', re.I)
IMG_RE = re.compile(r'<img[^>]+src=["\']([^"\']+\.(?:jpg|jpeg|png|webp|gif)(?:\?[^"\']*)?)["\']', re.I)
# Skip tracking pixels and tiny logos
SKIP_DOMAINS = ('doubleclick.', 'googletagmanager.', 'facebook.com/tr', 'google-analytics.')


class ImageExtractor(HTMLParser):
    """Lightweight HTML parser that pulls og:image / first <img>."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.images: list[str] = []
        self.og: str | None = None
        self.twitter: str | None = None
        self.found_og = False
        self.found_twitter = False
        self.found_first_img = False
        # Cap on img tags to scan (cheaper parsing)
        self.max_imgs = 50
        self.imgs_scanned = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        if tag.lower() == 'meta':
            d = {k.lower(): v for k, v in attrs if v}
            prop = d.get('property', '').lower()
            name = d.get('name', '').lower()
            content = d.get('content', '')
            if prop == 'og:image' and content and not self.found_og:
                self.og = content
                self.found_og = True
            elif name == 'twitter:image' and content and not self.found_twitter:
                self.twitter = content
                self.found_twitter = True
            elif name == 'twitter:image:src' and content and not self.found_twitter:
                self.twitter = content
                self.found_twitter = True
        elif tag.lower() == 'img' and not self.found_first_img and self.imgs_scanned < self.max_imgs:
            self.imgs_scanned += 1
            d = {k.lower(): v for k, v in attrs if v}
            src = d.get('src') or d.get('data-src')
            if src:
                self.images.append(src)
                self.found_first_img = True


def is_valid_image_url(url: str) -> bool:
    if not url or not url.startswith(('http://', 'https://')):
        return False
    if any(s in url for s in SKIP_DOMAINS):
        return False
    return True


async def fetch_image(session: aiohttp.ClientSession, url: str, sem: asyncio.Semaphore) -> str | None:
    if not url or not url.startswith(('http://', 'https://')):
        return None
    async with sem:
        try:
            async with session.get(
                url,
                timeout=aiohttp.ClientTimeout(total=15),
                headers={'User-Agent': 'Mozilla/5.0 AntenaImageBot/1.0'},
                allow_redirects=True,
            ) as resp:
                if resp.status != 200:
                    return None
                # Cap download to 1MB to avoid huge pages
                body = await resp.content.read(1_000_000)
                content_type = resp.headers.get('Content-Type', '')
                if 'text/html' not in content_type and 'application/xhtml' not in content_type:
                    return None
                html = body.decode('utf-8', errors='ignore')
        except Exception:
            return None

    ext = ImageExtractor()
    try:
        ext.feed(html)
    except Exception:
        return None

    # Priority: og:image > twitter:image > first <img>
    if ext.og and is_valid_image_url(ext.og):
        return urljoin(url, ext.og)
    if ext.twitter and is_valid_image_url(ext.twitter):
        return urljoin(url, ext.twitter)
    if ext.images:
        for img in ext.images:
            if is_valid_image_url(img):
                return urljoin(url, img)
    return None


async def main_async(args):
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=120000')

    sql = '''
        SELECT id, article_url, source_url FROM news_cards
        WHERE (image_url IS NULL OR image_url = '')
        AND (article_url IS NOT NULL AND article_url != ''
             OR (source_url IS NOT NULL AND source_url != ''))
    '''
    if args.limit:
        sql += f' LIMIT {args.limit}'
    rows = conn.execute(sql).fetchall()
    print(f'Found {len(rows)} cards to process')

    sem = asyncio.Semaphore(args.workers)
    timeout = aiohttp.ClientTimeout(total=20)
    connector = aiohttp.TCPConnector(limit=args.workers, limit_per_host=2)
    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        async def process_one(nc_id: str, url: str) -> tuple[str, str | None]:
            img = await fetch_image(session, url, sem)
            return nc_id, img

        tasks = []
        for nc_id, article_url, source_url in rows:
            url = article_url or source_url
            tasks.append(process_one(nc_id, url))

        updated = 0
        failed = 0
        for i, (nc_id, img) in enumerate(await asyncio.gather(*tasks), 1):
            if img:
                if not args.dry_run:
                    conn.execute('UPDATE news_cards SET image_url = ? WHERE id = ?', (img, nc_id))
                    updated += 1
                else:
                    updated += 1
            else:
                failed += 1
            if i % 50 == 0:
                print(f'  [{i}/{len(rows)}] updated={updated} failed={failed}')
                if not args.dry_run:
                    conn.commit()

        if not args.dry_run:
            conn.commit()

        print(f'\nDone: {updated} updated, {failed} failed, {len(rows)} total')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--workers', type=int, default=8)
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == '__main__':
    main()
