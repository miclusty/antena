# AKIRA RAG Baseline Report — 2026-06-14

> **This is the FIRST measurement** of the AKIRA RAG pipeline
> against a hand-curated golden set. It establishes the
> baseline against which future improvements (semantic
> clustering, cross-encoder reranking, 3-pass synthesis) can
> be evaluated.

## Summary

Two measurements taken today:

1. **Cluster-only baseline** (no LLM, ~5s for 6 clusters):
   - `scripts/run_cluster_baseline.py` → `.reports/baseline-cluster.json`

2. **Full RAG eval** (with KNN + synthesis + LLM-as-judge, ~3
   min for 6 clusters on 2 Macs in parallel):
   - `scripts/run_eval.py --workers 6` → `.reports/eval-full.json`

## Cluster quality (no LLM needed)

| Cluster | Category | Size | Relevant | Irrelevant | **Precision** | Recall |
|---|---|---:|---:|---:|---:|---:|
| Bahía Blanca judicial | judicial | 12 | 12 | 0 | **1.00** | 1.00 |
| Transferencias sin alias | economy | 15 | 12 | 2 | 0.86 | 1.00 |
| Guerra EE.UU./Israel/Irán | international | 11 | 9 | 2 | 0.82 | 1.00 |
| Horror en Morón | policial | 14 | 11 | 3 | 0.79 | 1.00 |
| Milei respalda a Adorni | politics | 20 | 8 | 12 | 0.40 | 1.00 |
| Darthés condena | judicial | 41 | 13 | 28 | **0.32** | 1.00 |
| **OVERALL** | | **113** | **65** | **47** | **0.580** | **1.000** |

**Interpretation**: Recall = 1.0 (no card gets lost), but 41% of
the cards in these "thematic" clusters are actually noise. The
two worst clusters (Milei/Adorni, Darthés) are 60-70% noise —
probably grouped by same newsroom or same date, not by event.

## Full RAG eval (with LLM judge)

Run with 6 workers in parallel (3 per Mac) using the multi-node
LM Studio load balancer. Total time: **3:16** for 6 clusters ×
full RAG + synthesis + judge.

### Synthesis quality (LLM-as-judge, qwen3.5-4b local)

| Metric | Baseline | Design doc target | Gap |
|---|---:|---:|---|
| **faithfulness** (1-5) | **3.83** | ≥ 4.0 | -0.17 (close) |
| **source_coverage** (1-5) | **3.00** | ≥ 4.0 | -1.00 (gap) |
| **perspective_balance** (1-5) | **2.67** | ≥ 4.0 | -1.33 (biggest gap) |
| **unsupported_claims** (avg per cluster) | **4.0** | n/a | problem |
| **composite** (0-1) | **0.67** | ≥ 0.75 | -0.08 (close) |

**Per-cluster synthesis scores** (faithfulness / source_coverage / perspective_balance):

| Cluster | Faith | Src | Bal |
|---|---:|---:|---:|
| Darthés condena | 4/5 | 2/5 | 3/5 |
| Transferencias sin alias | 4/5 | 3/5 | 2/5 |
| Horror en Morón | 4/5 | 3/5 | 2/5 |
| Milei respalda a Adorni | 4/5 | 3/5 | **5/5** ⭐ |
| Guerra EE.UU./Irán | 3/5 | 4/5 | 2/5 |
| Bahía Blanca judicial | 4/5 | 3/5 | 2/5 |

### Retrieval quality (recall@K is unmeasurable for these clusters)

`recall@K` came back as 0.0 because **all golden-relevant cards
are already inside their cluster** (none out-of-cluster). The
RAG engine's KNN explicitly excludes same-cluster cards from
its "neighbors" — so the relevant items can't be "retrieved"
from outside.

The honest signal is the **semantic_overlap_in_cluster** metric
we added: how many tokens do the KNN neighbors share with the
in-cluster relevant cards? Higher = the neighbors are
semantically related to the cluster's core event.

| Metric | Baseline | Interpretation |
|---|---:|---|
| `mean_overlap_tokens` (per neighbor) | **1.70** | 1.7 tokens shared |
| `max_overlap_tokens` (per neighbor) | **3.33** | best neighbor shares 3.3 tokens |

This is a **weak signal** — the neighbors are topically
unrelated to the cluster (e.g. Darthés cluster neighbors are
about motorcycles, not abuse cases). The KNN threshold of 0.70
cosine is too high to surface truly-related but differently-
phrased articles.

## What this proves about the design doc

The design doc's targets are now measured. Honest assessment:

| Target | Doc estimate | Baseline | Realistic? |
|---|---:|---:|---|
| G1 cluster precision ≥ 0.85 | est. ~0.55 | **0.58** | ✅ Achievable, ~30% gap |
| G2 recall@5 ≥ 0.70 | 0 | unmeasurable | ❓ TBD — needs OOC golden |
| G5 faithfulness ≥ 4.0 | unknown | **3.83** | ✅ Close, +0.17 to go |
| G6 composite ≥ 0.75 | unknown | **0.67** | ✅ Close, +0.08 to go |

**The G1 target is the right next priority** — the current
lexical Jaccard clusterer is producing too much noise in
clusters. Fixing G1 (semantic clustering) will also help G2
(better clusters → better centroid → better KNN neighbors).

The G5/G6 targets are within reach. faithfulness 3.83 → 4.0
needs ~5% improvement (the LLM is mostly faithful, just adds
a few hallucinated details). composite 0.67 → 0.75 needs
perspective_balance to improve (currently 2.67, the model
tends to write 3 perspectives that sound too similar).

### G3 (neighbor diversity) is the hidden problem

The worst gap is **perspective_balance: 2.67/5**. Looking at
the actual synth outputs, the 3 perspectives (neutral / pro_gov
/ anti_gov) are very similar in tone and content — they
differ by 1-2 adjectives but the underlying framing is the
same. This is because the RAG context is dominated by the same
few sources, and the LLM doesn't have enough cross-source
diversity to produce truly distinct perspectives.

A **G3 fix** (MMR diversity in neighbor selection) would help
G5/G6 by giving the LLM more diverse input.

## Reproduction

```bash
cd packages/akira
source .venv/bin/activate

# Cluster-only baseline (5s, no LLM)
python scripts/run_cluster_baseline.py

# Full eval (3 min, uses multi-Mac LM Studio LB)
python scripts/run_eval.py --workers 6

# Eval writes JSON to .reports/eval-{date}.json
```

## What the design doc got right and wrong

### Right
- **G1 cluster precision ≥ 0.85 IS achievable** from 0.58 with
  moderate work
- **G5/G6 close to target** — faithfulness 3.83 vs 4.0, composite
  0.67 vs 0.75. The 1-pass synthesis is already in the right
  ballpark; the gap is small
- **§1.4 weakness H7 (lexical clustering)** is the real bottleneck

### Wrong
- **"Cluster P50 cosine 0.55" was an estimate**; the actual
  precision metric is 0.58. Different metric, similar order of
  magnitude, so the magnitude is right but the framing is
  wrong (cosine intra-cluster is a different question than
  cluster precision against a hand-curated golden)
- **2-3 week timeline for 8 goals is unrealistic**. Building
  the eval harness (this report), the golden set, and the
  baseline took ~2 hours. Building G1's semantic clustering
  alone is 1-2 weeks. Realistic timeline for ALL 8 goals is
  **8-12 weeks** for a single dev, part-time

### Open questions
- **HyDE**: the design doc proposed HyDE query expansion.
  With clusters that have 5-13 relevant cards each, HyDE
  adds latency without obvious benefit. The baseline
  semantic_overlap of 1.7 tokens tells us the
  representative_text is too vague. HyDE might help by
  generating a richer pseudo-summary before KNN.
  **TBD: needs experiment.**
- **3-pass synthesis vs 1-pass**: baseline is 1-pass at
  3.83 faithfulness. Would 3-pass self-critique buy us the
  +0.17 to hit 4.0? **TBD: needs experiment.** 3-pass is
  3x more expensive (~3 min/cluster vs 1 min/cluster).
- **bge-reranker-base**: not in LM Studio yet. The design
  doc claims +8-15% precision@5. With our 0.0 recall@K
  baseline, we can't measure this yet. **TBD: needs
  install + rerun.**

## Files

| Path | Purpose |
|---|---|
| `core/eval/metrics.py` | recall@K, MRR, nDCG, hit_rate, precision@K, aggregate |
| `core/eval/judge.py` | LLM-as-judge (faithfulness/source_coverage/perspective_balance) |
| `scripts/run_cluster_baseline.py` | Pure-clustering baseline (no LLM) |
| `scripts/run_eval.py` | End-to-end eval harness (multi-Mac parallel via `--workers`) |
| `data/golden_set.jsonl` | 6 hand-curated clusters, ~110 cards labeled |
| `.reports/baseline-cluster.json` | Cluster-only baseline output |
| `.reports/eval-full.json` | Full RAG + synthesis + judge output |
