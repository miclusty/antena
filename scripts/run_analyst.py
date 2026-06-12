#!/usr/bin/env python3
"""run_analyst.py - Analyze raw news items using MiniMax API."""
import os
import sqlite3
import requests
import time
import json
from datetime import datetime

DB_PATH = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
BATCH_SIZE = 10
RATE_LIMIT = 1.0  # seconds between requests
API_KEY = os.getenv("MINIMAX_API_KEY")
AKIRA_API = "http://localhost:5050/extract"

if not API_KEY:
    print("ERROR: MINIMAX_API_KEY env var not set")
    exit(1)

print("=== ANALYST v1.0 ===")

def analyze_item(item):
    """Use MiniMax API to analyze a single news item."""
    prompt = f"""Analiza esta noticia y devuelve un JSON con:
- neutral_summary: resumen en lenguaje objetivo (máx 200 chars)
- bias_score: número entre -1 (oposición) y 1 (oficialista), 0 es neutral
- bias_reasoning: explicación breve del sesgo
- is_gacetilla: true si es comunicado de prensa gubernamental
- category: categoria (politica, economia, deportes, sociedad, cultura, tecnologia, mundo, locales)

Noticia:
Título: {item['title']}
Cuerpo: {item.get('body', '')[:1000]}
URL: {item['original_url']}

Responde SOLO con JSON válido, sin explicaciones."""    
    
    try:
        response = requests.post(
            "https://api.minimax.io/v1/text/chatcompletion_v2",
            headers={"Authorization": f"Bearer {API_KEY}"},
            json={
                "model": "MiniMax-M2.7",
                "messages": [{"role": "user", "content": prompt}]
            },
            timeout=30
        )
        
        if response.status_code != 200:
            return None
        
        result = response.json()
        content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
        
        # Parse JSON from response
        # Try to extract JSON block
        json_str = content
        if "```json" in content:
            json_str = content.split("```json")[1].split("```")[0]
        elif "```" in content:
            json_str = content.split("```")[1].split("```")[0]
        
        parsed = json.loads(json_str.strip())
        return {
            "neutral_summary": parsed.get("neutral_summary", ""),
            "bias_score": float(parsed.get("bias_score", 0)),
            "bias_reasoning": parsed.get("bias_reasoning", ""),
            "is_gacetilla": parsed.get("is_gacetilla", False),
            "category": parsed.get("category", "locales")
        }
    except Exception as e:
        print(f"Error analyzing {item['id']}: {e}")
        return None

def process_batch(conn, items):
    """Process a batch of items."""
    processed = 0
    for item in items:
        analysis = analyze_item(item)
        if analysis:
            # Insert into processed_news
            processed_id = item['id']  # Reuse the raw_news id
            conn.execute("""
                INSERT OR REPLACE INTO processed_news 
                (id, source_id, location_id, original_url, title, body, summary, 
                 neutral_summary, image_url, bias_score, bias_reasoning, 
                 is_gacetilla, gacetilla_confidence, category, published_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_clean')
            """, (
                processed_id,
                item['source_id'],
                item.get('location_id'),
                item['original_url'],
                item['title'],
                item.get('body', ''),
                item.get('summary', ''),
                analysis['neutral_summary'],
                item.get('image_url'),
                analysis['bias_score'],
                analysis['bias_reasoning'],
                1 if analysis['is_gacetilla'] else 0,
                0.8 if analysis['is_gacetilla'] else 0.0,
                analysis['category'],
                item.get('published_at')
            ))
            
            # Update raw_news status
            conn.execute("UPDATE raw_news SET status = 'processed' WHERE id = ?", (item['id'],))
            processed += 1
        
        # Rate limiting
        time.sleep(RATE_LIMIT)
    
    return processed

conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA busy_timeout = 30000")

total_processed = 0
offset = 0

while True:
    # Fetch batch of pending items
    rows = conn.execute("""
        SELECT id, source_id, location_id, original_url, title, body, summary, 
               image_url, published_at
        FROM raw_news 
        WHERE status = 'pending'
        LIMIT ?
    """, (BATCH_SIZE,)).fetchall()
    
    if not rows:
        print("No more pending items")
        break
    
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
            'image_url': row[7],
            'published_at': row[8]
        })
    
    processed = process_batch(conn, items)
    conn.commit()
    total_processed += processed
    offset += len(items)
    
    print(f"Processed {offset} items ({processed} in this batch)")
    
    if processed == 0:
        break

print(f"\n=== DONE: {total_processed} items analyzed ===")
conn.close()