# AKIRA RAG Baseline Report — 2026-06-14

> **Four measurement passes** today. The honest picture:
> v3 (current) has composite 0.69 — close to but not at
> the design doc's 0.75 target. The cluster precision
> baseline improved to 0.621 (from 0.580) thanks to a
> better-tuned v2 clusterer. G1 (semantic clustering)
> attempted but didn't beat the v2 clusterer on the
> golden set — see the "G1 lite attempt" section.

## v3 Final Results (5-6/6 clusters successful depending on run)

| Metric | v1 baseline | v2 (filter+parser) | v3 (with 3-pass + tuned clusterer) | Target | Δ vs target |
|---|---:|---:|---:|---:|---:|
| **faithfulness** (1-5) | 3.83 | **4.00** | 3.67 | ≥ 4.0 | **-0.33** (lost 0.33 in v3) |
| source_coverage (1-5) | 3.00 | 3.00 | **3.33** | ≥ 4.0 | -0.67 |
| perspective_balance (1-5) | 2.67 | 2.60 | **3.00** | ≥ 4.0 | **-1.00** (best so far) |
| unsupported_claims (per cluster) | 4.0 | 3.0 | 4.83 | n/a | +0.83 (regression) |
| **composite** (0-1) | 0.67 | 0.68 | **0.69** | ≥ 0.75 | -0.06 |

The v3 numbers are noisy (different runs give slightly
different results because the LLM is non-deterministic at
temp=0.2). The trend is clear: **+0.02 composite from v1
to v3, with 3-pass self-consistency (opt-in) bumping
perspective_balance by +0.4 from v2 to v3**.

## Cluster quality baseline (current state)

| Cluster | Size | Precision | Recall |
|---|---:|---:|---:|
| Bahía Blanca judicial | 12 | 1.00 | 1.00 |
| Transferencias sin alias | 15 | 0.86 | 1.00 |
| Guerra EE.UU. / Israel / Irán | 11 | 0.78 | 0.78 |
| Horror en Morón | 13 | 0.85 | 1.00 |
| Milei respalda a Adorni | (varies) | ~0.40 | 1.00 |
| Darthés condena | 44 | 0.29 | 0.85 |
| **OVERALL** | varies | **0.621** | **0.831** |

The v2 clusterer is the bottleneck for the 2 worst clusters
(Milei/Adorni, Darthés condena). Both are about 30-40% noise
— the Jaccard lexical algorithm pulls in cards that share a
source/date with the core event, not cards that share
semantic content.

## G1 lite attempt (and why it failed)

The design doc's G1 (intra-cluster precision ≥ 0.85) was
attempted via `core/cluster_semantic.py` (a 1-shot
post-processing pass that re-assigns `bias_score=0` cards
based on cosine similarity to existing cluster centroids).
The intent: move off-topic noise out of thematic clusters
by treating it as "unassigned" and finding a better cluster
or a singleton.

Result: the lite version **did not work**. At threshold 0.65,
precision went 0.580 → 0.786 (+35%) but recall dropped
1.000 → 0.169 (-83%). The lite G1 was too aggressive —
it moved `bias_score=0` cards out of their correct clusters
because those cards happened to be cosinely-similar to
something else (the corpus has many cards with similar
embeddings due to the embedding model collapsing common
Argentina-news terms).

Root cause: the G1 lite conflated "bias_score=0" with
"noise", but in our corpus most cards are `bias_score=0`
(only ~10% of cards went through the LLM bias detector).
The relevant cards of the golden set are mostly
`bias_score=0` too — moving them out of the cluster
breaks recall catastrophically.

**Conclusion**: G1 (semantic clustering) is the right
direction, but the lite version is wrong. The full G1
would need to:
  - Use bias_score=0 as a *signal* not a filter
  - Or do content-addressed clustering (md5 of
    member set) which is the design doc's proposal
  - Or use cross-encoder reranking on candidate cluster
    assignments before committing

This is left for a future iteration. The current best
result is the v2 clusterer (precision 0.621, recall 0.831)
without any post-processing.

## What changed in this iteration

1. **Tuned the v2 clusterer**: re-ran with the v2 algorithm
   (post-`normalize_text` bug fix), which produces 1,475
   clusters vs the v1's 1,571. The new distribution is
   slightly better-balanced (precision 0.621, recall 0.831).

2. **Added 3-pass self-consistency synthesis (opt-in)**:
   `RAGEngine.synthesize_3pass(cluster_id, concurrency=3)`.
   Each perspective gets its own LLM call with a perspective-
   specific system prompt. Eval shows perspective_balance
   improves +0.4 vs 1-pass, at the cost of faithfulness
   -0.33 (more LLM calls = more hallucination chances).
   Useful for UI sections that need distinct viewpoints.

3. **G1 lite attempt** (above): did not work. Documented
   so future iterations don't repeat the mistake.

## Reproduction

```bash
cd packages/akira
source .venv/bin/activate

# Cluster-only baseline (5s, no LLM)
python scripts/run_cluster_baseline.py

# Full RAG eval with v3 improvements (~7 min, 6 workers, 2 Macs)
python scripts/run_eval.py --workers 6

# 3-pass opt-in: edit run_eval.py's _process_cluster
# to call engine.synthesize_3pass(...) instead of
# engine.synthesize(...) for ablation experiments.
```

## What this proves about the design doc

### Targets we now meet
- None new. Faithfulness 4.0 was hit in v2 but lost 0.33 in v3
  due to noise from the re-clustering.

### Targets close to being met
- **G6: composite ≥ 0.75**: we are at 0.69, gap is 0.06. The
  next 0.06 likely requires G1 (full semantic clustering)
  + a stronger LLM-as-judge loop.

### Targets still open
- **G1: cluster precision ≥ 0.85**: still at 0.62, gap is 0.23.
  The lite G1 approach failed; the full G1 (content-
  addressed cluster_ids + cosine) is the right direction
  but needs careful threshold tuning.
- **G2: recall@5 ≥ 0.70**: unmeasurable with current golden
  set (all relevant items are in-cluster).
- **G3: neighbor diversity (nDCG P90 ≤ 0.92)**: not measured.

## Files

| Path | Purpose |
|---|---|
| `core/eval/metrics.py` | recall@K, MRR, nDCG, hit_rate, precision@K, aggregate (handles nested dicts) |
| `core/eval/judge.py` | LLM-as-judge (faithfulness/source_coverage/perspective_balance) |
| `core/rag.py` | RAG engine with: cluster filter (bias_score != 0), tolerant JSON parser, optional 3-pass self-consistency |
| `core/cluster_semantic.py` | G1 lite semantic re-clusterer (EXPERIMENTAL, did not beat v2) |
| `scripts/run_cluster_baseline.py` | Pure-clustering baseline (no LLM) |
| `scripts/run_eval.py` | End-to-end eval harness with `--workers N` parallelism |
| `scripts/recluster_with_cosine.py` | Driver for the G1 lite (kept for ablation) |
| `scripts/cluster_all_cards.py` | v2 clusterer (Jaccard lexical, post bug-fix) |
| `data/golden_set.jsonl` | 6 hand-curated clusters, ~110 cards labeled |
| `.reports/baseline-after-revert.json` | Current cluster baseline (precision 0.621, recall 0.831) |
| `.reports/eval-3pass.json` | v3 with 3-pass enabled |
| `.reports/eval-final.json` | v2 (cluster filter + parser) — best faithfulness |
| `.reports/BASELINE.md` | This report |
