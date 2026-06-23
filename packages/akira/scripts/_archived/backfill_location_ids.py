#!/usr/bin/env python3
# DEPRECATED 2026-06-20: Location ID backfill.
# Location resolution is now handled at harvest time via source.city → locations lookup.
# Do NOT run this script unless you know what you're doing. See git history
# for the implementation if you need to revive it.
#
# Original docstring preserved below for reference.
#
"""
Backfill news_cards.location_id based on:
  1. Source's location_id (most specific)
  2. Province inference from URL pattern
  3. Province inference from title keywords

Why: 1235/1501 cards have location_id=1 ("Argentina") because
most sources table rows have location_id=1. The feed ends up
showing 0 results for 15 of 24 provinces even though the
articles clearly belong to specific provinces.

Usage:
    cd packages/akira
    source .venv/bin/activate
    python scripts/backfill_location_ids.py [--dry-run] [--limit 1000]
"""
import argparse
import re
import sqlite3
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))
AKIRA_ROOT = os.path.dirname(HERE)
DB_PATH = os.path.join(AKIRA_ROOT, 'data', 'akira.db')

# Province detection: keywords → province_id
# Province IDs from the locations table:
# 1=Argentina (default, all 1-cards land here)
# 2=Buenos Aires
# 3=Córdoba
# 4=Santa Fe
# 5=Mendoza
# 6=Tucumán
# 7=Entre Ríos
# 8=Salta
# 9=Misiones
# 10=Corrientes
# 11=Chaco
# 12=Santiago del Estero
# 13=San Juan
# 14=Río Negro
# 15=Neuquén
# 16=Formosa
# 17=San Luis
# 18=La Pampa
# 19=Chubut
# 20=CABA
# 21=Catamarca
# 22=Jujuy
# 23=La Rioja
# 24=Santa Cruz
# 25=Tierra del Fuego

# Patterns extracted from known source URLs
URL_PROVINCE_PATTERNS = [
    # (regex on url, province_id)
    (r'cordoba|cordobes|cba24', 3),
    (r'santafe|santafesino|litoral|rosario', 4),
    (r'mendoza|mdz', 5),
    (r'tucuman|tucumano', 6),
    (r'salta', 8),
    (r'misiones|posadas', 9),
    (r'corrientes', 10),
    (r'chaco|chacoactualidad', 11),
    (r'sanjuan|sanjuan8', 13),
    (r'rionegro|bariloche', 14),
    (r'neuquen', 15),
    (r'formosa', 16),
    (r'sanluis|puntano', 17),
    (r'lapampa|pampa', 18),
    (r'chubut|comodoro|trelew|esquel', 19),
    (r'catamarca', 21),
    (r'jujuy', 22),
    (r'larioja', 23),
    (r'santacruz|rio.*gallegos', 24),
    (r'tierradelfuego|tierradelfuego|ushuaia|riogrande', 25),
    (r'buenosaires|ba\.com|mdp|mar.*del.*plata|mdql|bahiablanca|tandil|quilmes|lanus|avellaneda|moreno|merlo|morón|pilar|ezeiza|alberdi', 2),
    (r'buenosaires|^\s*$|caba|palermo|recoleta|belgrano', 20),
    (r'chubut|patagonia', 19),
    (r'patagonico|patagonia|austral', 24),
]

# Title keywords (more specific)
TITLE_PROVINCE_PATTERNS = [
    (r'\bcórdoba\b|cordobés|cordobesa', 3),
    (r'\bsanta fe\b|santafesino|santafesina', 4),
    (r'\bmendoza\b|mendocino|mendocina', 5),
    (r'\btucumán\b|tucumano|tucumana', 6),
    (r'\bsalta\b|salteño|salteña', 8),
    (r'\bmisiones\b|posadas', 9),
    (r'\bcorrientes\b|correntino|correntina', 10),
    (r'\bresistencia\b|\bchaco\b', 11),
    (r'\bsan juan\b', 13),
    (r'\brío negro\b|bariloche|viedma', 14),
    (r'\bneuquén\b|neuquino', 15),
    (r'\bformosa\b|formoseño', 16),
    (r'\bsan luis\b|puntano', 17),
    (r'\bla pampa\b|pampeano', 18),
    (r'\bchubut\b|comodoro|trelew|esquel|rawson', 19),
    (r'\bcatamarca\b|catamarqueño', 21),
    (r'\bjujuy\b|jujeño', 22),
    (r'\bla rioja\b|riojano', 23),
    (r'\bsanta cruz\b|riogallegos|caleta olivia|pico truncado', 24),
    (r'\bushuaia\b|\btierra del fuego\b|\brío grande\b', 25),
    (r'\bcaba\b|ciudad autónoma|ciudad de buenos aires', 20),
    (r'\bbuenos aires\b|^\s*$|bonaerense|la plata|mar del plata|bahía blanca', 2),
]


def detect_province_from_url(url: str) -> int | None:
    if not url:
        return None
    url = url.lower()
    for pattern, prov_id in URL_PROVINCE_PATTERNS:
        if re.search(pattern, url, re.I):
            return prov_id
    return None


def detect_province_from_title(title: str) -> int | None:
    if not title:
        return None
    title_lower = title.lower()
    for pattern, prov_id in TITLE_PROVINCE_PATTERNS:
        if re.search(pattern, title_lower, re.I):
            return prov_id
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--limit', type=int, default=0, help='0 = all')
    args = parser.parse_args()

    conn = sqlite3.connect(str(DB_PATH), timeout=30)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=120000')

    # Get all news_cards with their source info
    sql = '''
        SELECT nc.id, nc.title, nc.location_id, nc.source_ids, s.url, s.location_id
        FROM news_cards nc
        JOIN sources s ON nc.source_ids = s.id
        WHERE 1=1
    '''
    if args.limit:
        sql += f' LIMIT {args.limit}'
    rows = conn.execute(sql).fetchall()
    print(f'Loaded {len(rows)} news_cards with source joins')

    # Current distribution
    cur_dist = dict(conn.execute('''
        SELECT location_id, COUNT(*) FROM news_cards GROUP BY location_id
    ''').fetchall())
    print('Current distribution:', cur_dist)

    updates: list[tuple[int, int, str, str]] = []  # (nc_id, new_loc, old_loc, reason)
    for row in rows:
        nc_id, title, cur_loc, source_ids, source_url, source_loc = row
        # If source already has a specific location (not Argentina), use that
        new_loc = None
        reason = ''
        if source_loc and source_loc > 1:
            new_loc = source_loc
            reason = 'from_source'
        else:
            # Try URL detection
            url_loc = detect_province_from_url(source_url or '')
            if url_loc and url_loc != cur_loc:
                new_loc = url_loc
                reason = 'from_url'
            else:
                # Try title detection
                title_loc = detect_province_from_title(title or '')
                if title_loc and title_loc != cur_loc:
                    new_loc = title_loc
                    reason = 'from_title'

        if new_loc and new_loc != cur_loc:
            updates.append((nc_id, new_loc, cur_loc, reason))

    print(f'Will update {len(updates)} cards')
    # Show breakdown
    by_new = {}
    for _nc_id, new_loc, _old_loc, reason in updates:
        key = (reason, new_loc)
        by_new[key] = by_new.get(key, 0) + 1
    for (reason, prov_id), count in sorted(by_new.items()):
        print(f'  {reason} → province {prov_id}: {count}')

    if args.dry_run:
        print('\nDRY RUN — no changes made')
        return

    # Apply updates
    cursor = conn.cursor()
    for nc_id, new_loc, _, _ in updates:
        cursor.execute('UPDATE news_cards SET location_id = ? WHERE id = ?', (new_loc, nc_id))
    conn.commit()
    print(f'Updated {len(updates)} cards')

    # New distribution
    new_dist = dict(conn.execute('''
        SELECT location_id, COUNT(*) FROM news_cards GROUP BY location_id
    ''').fetchall())
    print('\nNew distribution:')
    for loc_id, count in sorted(new_dist.items(), key=lambda x: -x[1]):
        name_row = conn.execute('SELECT name FROM locations WHERE id = ?', (loc_id,)).fetchone()
        name = name_row[0] if name_row else '?'
        print(f'  {loc_id:3d} {name[:30]:30s}: {count}')


if __name__ == '__main__':
    main()
