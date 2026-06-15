#!/usr/bin/env bash
# AKIRA pipeline orchestrator (auto-run, every 6h via launchd).
#
# Runs:
#   1. Reset seen_urls (so RSS feeds re-extract today's items)
#   2. harvest_run.py — fetch all 680 active sources, insert into SQLite
#   3. enrich_body_parallel.py — fetch article body with trafilatura
#   4. embed_cards.py — vectorize cards (nomic embed via LM Studio M5)
#   5. cluster_all_cards.py — re-cluster cards (cosine on embeddings)
#   6. sync_to_d1_remote.py — push to D1 production
#
# Entity extraction (extract_entities.py) is OMITTED from the
# cron run. Qwen 3.5-4B on LM Studio runs in "thinking" mode
# (~20s/req for 200 cards = 18 min), and that flag is
# hardcoded in this model — there's no API parameter to
# disable it. Entity extraction is a manual task; run
# `python scripts/extract_entities.py` from a shell
# when you have time to spare.
#
# Designed to be invoked by launchd (every 6h) or manually.
# Logs to /tmp/akira-pipeline.log

set -e
cd "$(dirname "$0")/.."

# launchd runs with a minimal PATH that doesn't include
# homebrew. The sync step needs `npx` (and indirectly
# `node`) on PATH. Add the common locations explicitly.
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Activate AKIRA venv
source .venv/bin/activate

# Optional: kill any old harvest/enrich process to avoid pile-up
pkill -f harvest_run.py 2>/dev/null || true
pkill -f enrich_body_parallel.py 2>/dev/null || true
sleep 1

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a /tmp/akira-pipeline.log
}

step() {
    local label="$1"
    local cmd="$2"
    local start
    start=$(date +%s)
    log "Step $label starting"
    if eval "$cmd" >> /tmp/akira-pipeline.out.log 2>&1; then
        log "Step $label OK in $(( $(date +%s) - start ))s"
    else
        log "Step $label FAILED in $(( $(date +%s) - start ))s (continuing)"
    fi
}

log "=== Pipeline start ==="

# Step 0: ensure AKIRA server is up
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

# Step 2: harvest (RSS + WordPress via AKIRA cascade)
step "1/6 harvest_run.py" \
    "python harvest_run.py"

# Step 3: enrich body with trafilatura (parallel)
step "2/6 enrich_body_parallel.py" \
    "python scripts/enrich_body_parallel.py --since-hours 1 --workers 10"

# Step 4: embed (nomic embed via LM Studio M5 — fast, ~30 cards/sec)
step "3/6 embed_cards.py" \
    "python scripts/embed_cards.py --limit 500"

# Step 5: cluster (uses embeddings to dedup stories)
step "4/6 cluster_all_cards.py" \
    "python scripts/cluster_all_cards.py --batch-size 500"

# Step 6: sync to D1
step "5/6 sync_to_d1_remote.py" \
    "python scripts/sync_to_d1_remote.py --limit 1000 --tables news_cards --config ../api/wrangler.toml"

# (manual) entity extraction: skip in cron. See script comment.
# (manual) KB build: depends on entities
# (manual) RAG synthesize: depends on KB

log "=== Pipeline complete ==="
