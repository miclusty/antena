#!/bin/bash
# Import curated news portals from news_portals_final_v2.json
# Uses location_id = 1 (Argentina) for all, can be refined later

JSON_FILE="/Users/omatic/proyectos/news/docs/temp/news_portals_final_v2.json"
DB="AKIRA_DB_ID"

echo "📦 Importing curated news portals..."
echo "Source: $JSON_FILE"

# Extract URLs and create SQL inserts
python3 -c "
import json
import sys

with open('$JSON_FILE') as f:
    data = json.load(f)

print(f'Found {len(data)} portals to import')

# Generate SQL statements (location_id=1 for Argentina)
for i, portal in enumerate(data[:100], 1):  # Start with first 100
    name = portal.get('dominio', 'Unknown')[:50]
    url = portal.get('url', '').rstrip('/')
    cms = portal.get('cms', 'unknown')
    
    # Skip invalid URLs
    if not url.startswith('http'):
        continue
        
    print(f'INSERT INTO sources (name, url, location_id, reliability_score, is_active) VALUES (\"{name}\", \"{url}\", 1, 0.5, 1);')

print(f'-- Total: 100 portals (first batch)')
" > /tmp/portals_batch1.sql

echo "Generated SQL for first 100 portals"
echo "Run: wrangler d1 execute DB --local --file=/tmp/portals_batch1.sql"
