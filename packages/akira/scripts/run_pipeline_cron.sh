#!/usr/bin/env bash
# AKIRA pipeline orchestrator.
#
# Runs:
#   1. Reset seen_urls (so RSS feeds re-extract today's items)
#   2. harvest_run.py — fetch all 681 active sources, insert into SQLite
#   3. enrich_body_parallel.py — fetch article body with trafilatura
#   4. sync_to_d1_remote.py — push to D1 production
#
# Designed to be invoked by launchd (every 6h) or manually.
# Logs to /tmp/akira-pipeline.log

set -e
cd "$(dirname "$0")/.."

# Activate AKIRA venv
source .venv/bin/activate

# Optional: kill any old harvest/enrich process to avoid pile-up
pkill -f harvest_run.py 2>/dev/null || true
pkill -f enrich_body_parallel.py 2>/dev/null || true
sleep 1

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a /tmp/akira-pipeline.log
}

log "=== Pipeline start ==="

# Step 0: ensure AKIRA server is up (the orchestrator assumes
# the FastAPI server is already running on :5100)
if ! curl -sf -m 5 http://127.0.0.1:5100/health > /dev/null; then
    log "ERROR: AKIRA server not running on :5100 — aborting"
    exit 1
fi
log "AKIRA server healthy"

# Step 1: reset dedup state so fresh items are picked up
log "Reset seen_urls + last_harvest_at + error_count"
sqlite3 data/akira.db <<EOF
DELETE FROM seen_urls;
UPDATE sources SET last_harvest_at = '1970-01-01' WHERE is_active = 1;
UPDATE source_health SET consecutive_failures = 0, is_circuit_open = 0;
UPDATE sources SET error_count = 0 WHERE is_active = 1;
EOF

# Step 2: harvest
log "Step 1/3: harvest_run.py"
START=$(date +%s)
python harvest_run.py 2>&1 | tail -5
log "Harvest done in $(( $(date +%s) - START ))s"

# Step 3: enrich body with trafilatura (parallel)
log "Step 2/3: enrich_body_parallel.py"
START=$(date +%s)
python scripts/enrich_body_parallel.py --since-hours 1 --workers 10 2>&1 | tail -5
log "Enrich done in $(( $(date +%s) - START ))s"

# Step 4: sync to D1
log "Step 3/3: sync_to_d1_remote.py"
START=$(date +%s)
python scripts/sync_to_d1_remote.py --limit 500 --tables news_cards --config ../api/wrangler.toml 2>&1 | tail -5
log "Sync done in $(( $(date +%s) - START ))s"

log "=== Pipeline complete ==="
