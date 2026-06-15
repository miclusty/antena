#!/usr/bin/env bash
# AKIRA pipeline orchestrator (auto-run, every 6h via launchd).
#
# Runs:
#   1. Reset seen_urls (so RSS feeds re-extract today's items)
#   2. harvest_run.py — fetch all 680 active sources, insert into SQLite
#   3. enrich_body_parallel.py — fetch article body with trafilatura
#   4. embed_cards.py — vectorize cards (nomic embed via LM Studio M5)
#   5. extract_entities.py — LLM-extract entities (qwen3.5-4b on M5)
#   6. build_kb.py — entity co-occurrence graph
#   7. cluster_all_cards.py — re-cluster cards (cosine on embeddings)
#   8. sync_to_d1_remote.py — push to D1 production
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
step "1/8 harvest_run.py" \
    "python harvest_run.py"

# Step 3: enrich body with trafilatura (parallel)
step "2/8 enrich_body_parallel.py" \
    "python scripts/enrich_body_parallel.py --since-hours 1 --workers 10"

# Step 4: embed (nomic embed via LM Studio M5)
step "3/8 embed_cards.py" \
    "python scripts/embed_cards.py --limit 500"

# Step 5: entity extraction (qwen3.5-4b via M5, thinking disabled)
step "4/8 extract_entities.py" \
    "python scripts/extract_entities.py --workers 4 --limit 500"

# Step 6: KB graph
step "5/8 build_kb.py" \
    "python scripts/build_kb.py"

# Step 7: re-cluster ALL cards with semantic embeddings
# Uses HDBSCAN density-based clustering on cosine similarity.
# Replaces the broken lexical-only clusterer. Produces:
# - Genuine per-event clusters (3-5 cards, multi-source coverage)
# - Outliers as singletons (the right outcome for one-off news)
# - Genuine topical clusters (regional, vertical — e.g. all
#   'San Pedro de Jujuy' or all 'inflación')
step "6.5/9 recluster_all_semantic.py" \
    "python scripts/recluster_all_semantic.py --min-cluster 3 --min-samples 2"

# Step 8: cluster (kept for incremental ingest of new cards
# without embeddings yet — runs the lexical pass to catch
# any cards that haven't been embedded)
step "7/9 cluster_all_cards.py" \
    "python scripts/cluster_all_cards.py --batch-size 500"

# Step 9: synthesize 3-perspective master articles via RAG.
# Uses qwen3.5-4b on LM Studio (M4 + M5, 2-node load balanced).
# --skip-existing means re-runs only synthesize clusters that
# don't yet have all 3 perspectives (the next pipeline cycle
# picks up where this one left off — completes in ~4-5h for
# 901 clusters at ~18s/cluster with 2 workers).
step "8.5/10 rag_synthesize.py" \
    "python scripts/rag_synthesize.py --workers 2 --skip-existing"

# Step 10: sync to D1
step "9/10 sync_to_d1_remote.py" \
    "python scripts/sync_to_d1_remote.py --limit 1000 --tables news_cards --config ../api/wrangler.toml"

log "=== Pipeline complete ==="
