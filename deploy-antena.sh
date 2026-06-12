#!/bin/bash
# deploy-antena.sh — Deploy Antena to Cloudflare Pages
# Usage: ./deploy-antena.sh <cloudflare-api-token> [account-id]
# 
# Get your API token at: https://dash.cloudflare.com/profile/api-tokens
# Required permissions: "Edit Cloudflare Pages"

set -e

ACCOUNT_ID="${2:-aec9ebbec62970f96aa639feaabdc9f5}"
TOKEN="$1"

if [ -z "$TOKEN" ]; then
  echo "Usage: $0 <cloudflare-api-token> [account-id]"
  echo ""
  echo "Deploys packages/antena to https://antena.pages.dev"
  echo ""
  echo "To get a Cloudflare API token:"
  echo "1. Go to https://dash.cloudflare.com/profile/api-tokens"
  echo "2. Create Token → Create Custom Token"
  echo "3. Add permissions: Account → Cloudflare Pages → Edit"
  echo "4. Account resource: Include → Your account"
  echo "5. Copy the token and run: $0 <your-token>"
  exit 1
fi

DIST_DIR="$(cd "$(dirname "$0")/packages/antena/dist" && pwd)"
PROJECT="antena"

echo "Deploying $DIST_DIR to Cloudflare Pages project '$PROJECT'..."
echo "Account: $ACCOUNT_ID"

response=$(curl -s -X POST "https://api.cloudflare.com/client/v4/pages/projects/$PROJECT/deployments" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Auth-Email: $(curl -s 'https://api.cloudflare.com/client/v4/user' -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["email"])')" \
  --data "$(jq -n --arg dir "$DIST_DIR" '{
    files: [],
    metadata: {
      version: "3",
      build_config: {
        runtime: "off",
        command: "cd packages/antena && pnpm install --frozen-lockfile && pnpm build",
        destination_dir: "packages/antena/dist"
      }
    }
  }')")

echo "$response" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("Deployment:", d.get("result",{}).get("url","FAILED"))'
