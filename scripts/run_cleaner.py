#!/usr/bin/env python3
"""run_cleaner.py - Filter and clean processed news items."""
import sqlite3
from datetime import datetime, timedelta

DB_PATH = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
BATCH_SIZE = 50

# Keywords that indicate non-news content
REJECT_KEYWORDS = [
    "horóscopo", "farmacia", "turno", "obituario", "defunción", 
    "santo дня", "sorteo", "lotería", "quiniela", "prophet", "horoscope"
]

# Minimum body length to be considered real news
MIN_BODY_LENGTH = 100

print("=== CLEANER v1.0 ===")

def should_reject(item, recent_titles):
    """Determine if an item should be rejected."""
    title_lower = item['title'].lower()
    
    # Check for reject keywords in title
    for kw in REJECT_KEYWORDS:
        if kw.lower() in title_lower:
            return True, f"reject_keyword:{kw}"
    
    # Check body length
    body = item.get('body', '') or ''
    if len(body) < MIN_BODY_LENGTH:
        return True, f"body_too_short:{len(body)}"
    
    # Check for duplicate title (case insensitive)
    if title_lower in recent_titles:
        return True, "duplicate_title"
    
    return False, None

def calculate_quality_score(item):
    """Calculate quality score 0-1 based on various factors."""
    score = 0.5  # base
    
    body = item.get('body', '') or ''
    
    # Longer body = higher score (up to 0.2)
    body_len = len(body)
    if body_len > 2000:
        score += 0.2
    elif body_len > 500:
        score += 0.1
    
    # Has image = higher score
    if item.get('image_url'):
        score += 0.15
    
    # Has summary = slightly higher
    if item.get('summary'):
        score += 0.05
    
    # Neutral bias is slightly preferred
    bias = abs(item.get('bias_score', 0))
    if bias < 0.3:
        score += 0.1
    
    return min(score, 1.0)

conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA busy_timeout = 30000")

total_cleaned = 0
total_rejected = 0
offset = 0

while True:
    # Fetch batch of pending_clean items
    rows = conn.execute("""
        SELECT id, source_id, location_id, original_url, title, body, summary,
               neutral_summary, image_url, bias_score, bias_reasoning,
               is_gacetilla, gacetilla_confidence, category, published_at
        FROM processed_news 
        WHERE status = 'pending_clean'
        LIMIT ?
    """, (BATCH_SIZE,)).fetchall()
    
    if not rows:
        print("No more pending_clean items")
        break
    
    # Get recent titles to check for duplicates
    recent_titles = set()
    recent = conn.execute("""
        SELECT LOWER(title) FROM clean_news 
        WHERE cleaned_at > datetime('now', '-7 days')
    """).fetchall()
    for r in recent:
        recent_titles.add(r[0])
    
    items = []
    for row in rows:
        items.append({
            'id': row[0],
            'source_id': row[1],
            'location_id': row[2],
            'original_url': row[3],
            'title': row[4],
            'body': row[5],
            'summary': row[6],
            'neutral_summary': row[7],
            'image_url': row[8],
            'bias_score': row[9],
            'bias_reasoning': row[10],
            'is_gacetilla': row[11],
            'gacetilla_confidence': row[12] or 0,
            'category': row[13],
            'published_at': row[14]
        })
    
    for item in items:
        reject, reason = should_reject(item, recent_titles)
        
        if reject:
            conn.execute("""
                UPDATE processed_news SET status = 'rejected' 
                WHERE id = ?
            """, (item['id'],))
            total_rejected += 1
            print(f"Rejected {item['id'][:8]}...: {reason}")
        else:
            quality_score = calculate_quality_score(item)
            
            # Insert into clean_news
            conn.execute("""
                INSERT INTO clean_news 
                (id, source_id, location_id, original_url, title, neutral_summary,
                 image_url, bias_score, is_gacetilla, cluster_id, category,
                 quality_score, published_at, synced)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            """, (
                item['id'],
                item['source_id'],
                item.get('location_id'),
                item['original_url'],
                item['title'],
                item['neutral_summary'] or item.get('summary', ''),
                item['image_url'],
                item['bias_score'],
                item['is_gacetilla'],
                None,  # cluster_id
                item['category'],
                quality_score,
                item['published_at']
            ))
            
            # Update processed_news status
            conn.execute("""
                UPDATE processed_news SET status = 'cleaned' 
                WHERE id = ?
            """, (item['id'],))
            
            total_cleaned += 1
            # Add title to recent_titles to catch duplicates within batch
            recent_titles.add(item['title'].lower())
    
    conn.commit()
    offset += len(items)
    print(f"Processed {offset} items ({total_cleaned} cleaned, {total_rejected} rejected)")
    
    if len(items) < BATCH_SIZE:
        break

print(f"\n=== DONE: {total_cleaned} cleaned, {total_rejected} rejected ===")
conn.close()