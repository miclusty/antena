#!/bin/bash
# Initialize AKIRA local SQLite database
# Complete schema for pipeline

set -e

DB_PATH="${AKIRA_DB_PATH:-$HOME/data/akira.db}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🗄️  Initializing AKIRA database..."
echo "   Path: $DB_PATH"
echo ""

# Create data directory
mkdir -p "$(dirname "$DB_PATH")"

# Remove existing DB for fresh start (optional)
if [ "$1" = "--reset" ]; then
  echo "🗑️  Resetting database..."
  rm -f "$DB_PATH"
fi

# Run complete schema
echo "📦 Creating schema..."
sqlite3 "$DB_PATH" < "$PROJECT_DIR/migrations/0001_complete_schema.sql"

echo ""
echo "✅ Database initialized!"

# Show stats
echo ""
echo "📊 Database stats:"
sqlite3 "$DB_PATH" <<EOF
.mode column
.headers on
SELECT 'categories' as table_name, COUNT(*) as count FROM categories
UNION ALL
SELECT 'locations', COUNT(*) FROM locations
UNION ALL
SELECT 'sources', COUNT(*) FROM sources
UNION ALL
SELECT 'news_cards', COUNT(*) FROM news_cards
UNION ALL
SELECT 'raw_news', COUNT(*) FROM raw_news
UNION ALL
SELECT 'processed_news', COUNT(*) FROM processed_news
UNION ALL
SELECT 'clean_news', COUNT(*) FROM clean_news;
EOF

echo ""
echo "🌍 Locations by type:"
sqlite3 "$DB_PATH" "SELECT type, COUNT(*) as count FROM locations GROUP BY type;"

echo ""
echo "🎯 Ready! Database at: $DB_PATH"
