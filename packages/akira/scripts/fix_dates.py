#!/usr/bin/env python3
"""Fix RFC 822 dates in akira.db"""
import sqlite3
from email.utils import parsedate_to_datetime

DB_PATH = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# Find all RFC 822 dates
cursor.execute("SELECT id, published_at FROM news_cards WHERE published_at LIKE '%, %'")
rows = cursor.fetchall()
print(f"Found {len(rows)} RFC 822 dates to convert")

updates = []
for card_id, rfc822_date in rows:
    try:
        dt = parsedate_to_datetime(rfc822_date)
        iso_date = dt.isoformat()
        updates.append((iso_date, card_id))
        print(f"  Card {card_id}: {rfc822_date[:40]}... -> {iso_date}")
    except Exception as e:
        print(f"  Card {card_id}: FAILED to parse '{rfc822_date[:40]}...' - {e}")

# Batch update
cursor.executemany("UPDATE news_cards SET published_at = ? WHERE id = ?", updates)
conn.commit()
print(f"\nUpdated {cursor.rowcount} rows")

# Verify
cursor.execute("SELECT COUNT(*) FROM news_cards WHERE published_at LIKE '%, %'")
remaining = cursor.fetchone()[0]
print(f"Remaining RFC 822 dates: {remaining}")

conn.close()
