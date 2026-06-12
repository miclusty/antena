#!/usr/bin/env python3
"""run_publisher.py - Publish clean news to news_cards table."""
import sqlite3
from datetime import datetime

DB_PATH = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
BATCH_SIZE = 50

print("=== PUBLISHER v1.0 ===")

conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA busy_timeout = 30000")

total_synced = 0
offset = 0

while True:
    # Fetch batch of unsynced clean items
    rows = conn.execute("""
        SELECT id, source_id, location_id, original_url, title, neutral_summary,
               image_url, bias_score, is_gacetilla, category, quality_score, published_at
        FROM clean_news 
        WHERE synced = 0
        ORDER BY published_at DESC
        LIMIT ?
    """, (BATCH_SIZE,)).fetchall()
    
    if not rows:
        print("No more unsynced items")
        break
    
    for row in rows:
        item_id, source_id, location_id, original_url, title, neutral_summary, \
        image_url, bias_score, is_gacetilla, category, quality_score, published_at = row
        
        # Insert into news_cards
        conn.execute("""
            INSERT OR REPLACE INTO news_cards 
            (id, location_id, title, summary, image_url, bias_score, 
             is_gacetilla, category, source_ids, published_at, 
             quality_score, neutral_summary, synced, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
        """, (
            item_id,
            location_id or 0,
            title,
            neutral_summary or '',
            image_url,
            bias_score or 0,
            is_gacetilla or 0,
            category or 'locales',
            str(source_id),
            published_at,
            quality_score or 0.5,
            neutral_summary or ''
        ))
        
        # Mark clean_news as synced
        conn.execute("""
            UPDATE clean_news SET synced = 1, synced_at = datetime('now')
            WHERE id = ?
        """, (item_id,))
        
        total_synced += 1
        
        if total_synced % 100 == 0:
            print(f"Synced {total_synced} items...")
    
    conn.commit()
    offset += len(rows)
    print(f"Batch complete: {len(rows)} items, total synced: {total_synced}")
    
    if len(rows) < BATCH_SIZE:
        break

print(f"\n=== DONE: {total_synced} items synced to news_cards ===")
conn.close()