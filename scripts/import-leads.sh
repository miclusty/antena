#!/bin/bash
# Import leads.json into local SQLite database
# Uses sqlite3 JSON1 extension for fast parsing

set -e

DB_PATH="${AKIRA_DB_PATH:-$HOME/data/akira.db}"
LEADS_FILE="${1:-$PWD/leads.json}"

if [ ! -f "$LEADS_FILE" ]; then
  echo "❌ Leads file not found: $LEADS_FILE"
  echo "Usage: $0 [path/to/leads.json]"
  exit 1
fi

echo "📥 Importing leads from: $LEADS_FILE"

# Count before
BEFORE=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM leads;")
echo "   Current leads in DB: $BEFORE"

# Fast bulk import using sqlite3 json_each
# JSON fields: dominio, cms, titular, cuit, url
echo "⏳ Parsing and inserting..."
sqlite3 "$DB_PATH" <<EOF
WITH json_data AS (
  SELECT value as item 
  FROM json_each(readfile('$LEADS_FILE'))
)
INSERT OR IGNORE INTO leads (url, domain, notes)
SELECT 
  json_extract(item, '\$.url') as url,
  json_extract(item, '\$.dominio') as domain,
  json_extract(item, '\$.cms') as notes
FROM json_data
WHERE json_extract(item, '\$.url') IS NOT NULL;
EOF

# Count after
AFTER=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM leads;")
NEW=$((AFTER - BEFORE))

echo "✅ Imported $NEW new leads"
echo "   Total leads in DB: $AFTER"

# Show breakdown
echo ""
echo "📊 Sample leads:"
sqlite3 "$DB_PATH" "SELECT url, domain, notes FROM leads LIMIT 5;"
