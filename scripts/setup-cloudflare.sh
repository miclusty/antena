#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Setting up AKIRA Cloudflare infrastructure..."

# Create D1 database
echo "📦 Creating D1 database..."
DB_OUTPUT=$(wrangler d1 create akira-db 2>&1)
DB_ID=$(echo "$DB_OUTPUT" | grep -o 'database_id = "[^"]*"' | cut -d'"' -f2)
echo "✅ D1 created: $DB_ID"

# Create KV namespace
echo "📦 Creating KV namespace..."
KV_OUTPUT=$(wrangler kv:namespace create akira-cache 2>&1)
KV_ID=$(echo "$KV_OUTPUT" | grep -o '"id"' | head -1)
echo "✅ KV created"

# Create R2 bucket
echo "📦 Creating R2 bucket..."
wrangler r2 bucket create akira-images
echo "✅ R2 created"

# Update wrangler.toml with IDs
echo "📝 Updating wrangler.toml..."
sed -i '' "s/AKIRA_DB_ID/$DB_ID/g" wrangler.toml

echo "✅ Infrastructure setup complete!"
echo ""
echo "Next steps:"
echo "1. Run: wrangler d1 migrations apply akira-db --remote"
echo "2. Run: wrangler d1 execute akira-db --remote --file=scripts/seed-locations.sql"
echo "3. Update .env with your Cloudflare credentials"
