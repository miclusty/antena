#!/bin/bash
# Verify sitemap/rss endpoints are live on prod.
# Manual integration check — run before releases.

set -e
echo "Checking sitemap endpoints on prod..."

check() {
  local url="$1"
  local status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$url")
  local size=$(curl -s --max-time 15 "$url" | wc -c)
  if [ "$status" = "200" ]; then
    echo "  ✓ $url → HTTP $status ($size bytes)"
  else
    echo "  ✗ $url → HTTP $status"
    return 1
  fi
}

check "https://www.antena.com.ar/sitemap.xml"
check "https://www.antena.com.ar/rss.xml"
check "https://www.antena.com.ar/sitemap-index.xml"
check "https://www.antena.com.ar/sitemap-cordoba.xml"

# HEAD requests on function routes return 404 (Pages doesn't run
# functions for HEAD). Verify a GET works while HEAD doesn't:
echo ""
echo "Note: HEAD returns 404 for function routes. GET works."
