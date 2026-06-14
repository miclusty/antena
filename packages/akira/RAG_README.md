# AKIRA RAG + LMWIKI — Multi-Mac LM Studio Pipeline

A 5-day build that adds three things to AKIRA:
1. **Vector store** — embeddings of every news card for semantic KNN
2. **Knowledge base** — entity graph (people/places/orgs) + co-occurrence edges
3. **3-perspective RAG synthesis** — neutral / pro-gov / anti-gov master articles

All powered by **two local Macs running LM Studio** (`qwen3.5-4b` + `text-embedding-nomic-embed-text-v1.5`).

## Architecture

```
┌──────────────────────┐    ┌──────────────────────┐
│  M4 (Mac Mini)       │    │  M5 (Mac Mini LAN)   │
│  LM Studio :1234     │    │  LM Studio :1234     │
│  qwen3.5-4b          │    │  qwen3.5-4b          │
│  nomic-embed-v1.5    │    │  nomic-embed-v1.5    │
└──────────┬───────────┘    └──────────┬───────────┘
           │                           │
           └─────────────┬─────────────┘
                         │
                  core/lmstudio.py
                  (in-flight LB, 6 workers/node)
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
  embed_cards.py   extract_entities.py  rag_synthesize.py
  (768d vectors)   (LLM JSON parse)     (3-perspective RAG)
        │                │                │
        └────────────────┴────────────────┘
                         ▼
                  akira.db (SQLite)
            news_embeddings + entities +
            entity_mentions + entity_co_occurrences
                         │
                         ▼
              master_articles (3 perspectives)
```

## Multi-Mac load balancing

`core/lmstudio.py` uses **in-flight request count** as the primary
pick signal. Each Mac runs the LLM sequentially per request, so
the node with **fewer concurrent in-flight requests** is the one
that can start the next call immediately.

Algorithm:
1. On startup, probe every node with a `/v1/models` GET to seed
   the latency tracking (avoids the "first to be tested wins"
   cold-start bug).
2. For each request: pick the healthy node with the lowest
   `in_flight` count. Tie-break by rolling avg latency, then by
   total request count (round-robin among equals).
3. Increment `in_flight` on the way out, decrement in the
   `finally`-equivalent (success or failure). Thread-safe via
   `threading.Lock`.

The default is 12 workers (6 per Mac), which empirically
saturates both nodes:

```
progress: 200/12962 mentions=722 failed=11 rate=1.01/s
nodes: [localhost:reqs=70 lat=20.00s inflight=6]
       [192.168.31.37:reqs=143 lat=7.47s inflight=6]
```

M5 ends up handling ~2x more requests than localhost because
its MLX-backed qwen3.5-4b is ~2.5x faster per call, so its
`in_flight` counter drains faster and it gets picked more often.

## Quick start

```bash
cd packages/akira
source .venv/bin/activate

# 1. Embed all 13k cards (vector store, ~4 min)
python scripts/embed_cards.py --workers 6

# 2. Extract entities via LLM (~3.4 hours at 1 card/s with 12 workers)
python scripts/extract_entities.py --workers 12

# 3. Build the knowledge-base graph (pure SQL, ~0.1s)
python scripts/build_kb.py

# 4. Synthesize 3-perspective master articles for every cluster (~hours)
python scripts/rag_synthesize.py --workers 4

# Or run the full pipeline in sequence:
python scripts/run_pipeline.py --no-body --workers 12
```

## Files

### Core (Day 1)
- `core/lmstudio.py` — multi-node LM Studio client with health
  checks, in-flight LB, embedding cache, latency tracking.
- `core/rag.py` — 3-perspective RAG engine: KNN over vector
  store + entity graph + bias distribution → JSON prompt →
  LLM → parsed perspectives.

### Scripts (Days 2-4)
- `scripts/embed_cards.py` — embed all news_cards via the
  embed model, store as JSON in `news_embeddings` (local).
- `scripts/extract_entities.py` — call the LLM to extract
  people/places/orgs/events from each card; idempotent.
- `scripts/build_kb.py` — pure SQL aggregation of co-occurrences
  into the graph table.
- `scripts/rag_synthesize.py` — for every cluster that doesn't
  have all 3 perspectives yet, call RAGEngine.synthesize() and
  write to master_articles.

### Schema (Day 1)
- `migrations/0003_rag_tables.sql` — D1 migrations for
  `entities`, `entity_mentions`, `entity_co_occurrences`,
  `rag_queries`, and the `clusters` table ALTERs.
- `migrations/0003b_d1_clusters.sql` — D1-only ALTERs for the
  per-perspective timestamps.
- Local-only: `news_embeddings` (vector store, not synced to D1).

## Configuration (env vars)

- `AKIRA_LMSTUDIO_NODES` — comma-separated URLs (default
  `http://localhost:1234,http://192.168.31.37:1234`).
- `AKIRA_LMSTUDIO_MODEL` — chat model (default `qwen3.5-4b`).
- `AKIRA_LMSTUDIO_EMBED` — embed model (default
  `text-embedding-nomic-embed-text-v1.5`).

## Performance

| Step | Time (13k cards, 2 nodes) | Bottleneck |
|------|--------------------------|------------|
| `embed_cards.py` | ~4 min | LM Studio embed throughput |
| `extract_entities.py` | ~3.4 h | LLM JSON output (12 workers, 6/node) |
| `build_kb.py` | <1 s | Pure SQL aggregation |
| `rag_synthesize.py` | ~hours | 1 LLM call per cluster, ~30s each |

## Known issues (TODO)

- **Cluster quality** (upstream): the v2 clustering algorithm
  sometimes groups unrelated stories in the same cluster_id.
  This is a pre-existing bug, not introduced by RAG. When this
  happens, the master article perspective quality suffers
  because the LLM has incoherent input. Fix: tighten the
  cluster threshold or add a coherence post-filter.
- **KNN neighbors**: with small or vague clusters, the
  top-K nearest vectors may not be semantically related
  (we filter at 0.70 cosine + require token overlap, but
  embeddings can still match on a single common word).
- **`body` field**: still 0% filled. Fetching body via
  AKIRA /extract is slow (8s/card). Skipped by default.
- **Master article schema** uses 1 row per cluster with 3
  perspective columns (`neutral_perspective`,
  `officialist_perspective`, `opposition_perspective`). A
  future improvement: split into 3 rows with a
  `perspective_type` column for cleaner JOINs.
