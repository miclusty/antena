#!/bin/bash
# Register a news source in local SQLite database
# Usage: ./scripts/register-source.sh "Name" "https://url.com" location_id [type] [rss_url]

set -e

DB_PATH="${AKIRA_DB_PATH:-$HOME/data/akira.db}"
NAME="${1}"
URL="${2}"
LOCATION_ID="${3}"
TYPE="${4:-portal}"
RSS_URL="${5}"

if [ -z "$NAME" ] || [ -z "$URL" ] || [ -z "$LOCATION_ID" ]; then
  echo "Usage: $0 'Name' 'https://url.com' location_id [type] [rss_url]"
  echo ""
  echo "Types: diario, portal, radio, tv"
  exit 1
fi

# Get location info
LOCATION=$(sqlite3 "$DB_PATH" "SELECT name, province FROM locations WHERE id = $LOCATION_ID;" 2>/dev/null)
if [ -z "$LOCATION" ]; then
  echo "⚠️ Location ID $LOCATION_ID not found"
  exit 1
fi

# Insert source
sqlite3 "$DB_PATH" "
  INSERT OR IGNORE INTO sources (name, url, location_id, type, rss_url, is_active)
  VALUES ('$NAME', '$URL', $LOCATION_ID, '$TYPE', '${RSS_URL}', 1);
"

# Check if inserted
EXISTS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sources WHERE url = '$URL';")
if [ "$EXISTS" -gt 0 ]; then
  echo "✅ Registered: $NAME ($URL)"
  echo "   Location: $LOCATION"
  echo "   Type: $TYPE"
else
  echo "⚠️ Source already exists: $NAME"
fi
