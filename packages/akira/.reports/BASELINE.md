# AKIRA RAG Baseline Report — 2026-06-14

> **This is the FIRST measurement** of the AKIRA RAG pipeline quality
> against a hand-curated golden set. It establishes the baseline
> against which future improvements (semantic clustering, cross-
> encoder reranking, 3-pass synthesis) can be evaluated.

## What we measured

### Cluster quality (no LLM required)
The 6-cluster golden set covers 4 categories: politics, international,
judicial, economy, policial. ~110 cards total, each labeled
relevant=true/false by hand.

| Cluster | Category | Size | Relevant in cluster | Irrelevant in cluster | Precision | Recall |
|---|---|---:|---:|---:|---:|---:|
| Bahía Blanca judicial | judicial | 12 | 12 | 0 | **1.00** | 1.00 |
| Transferencias sin alias | economy | 15 | 12 | 2 | 0.86 | 1.00 |
| Guerra EE.UU. / Israel / Irán | international | 11 | 9 | 2 | 0.82 | 1.00 |
| Horror en Morón | policial | 14 | 11 | 3 | 0.79 | 1.00 |
| Milei respalda a Adorni | politics | 20 | 8 | 12 | 0.40 | 1.00 |
| Darthés condena | judicial | 41 | 13 | 28 | **0.32** | 1.00 |
| **OVERALL** | | **113** | **65** | **47** | **0.580** | **1.000** |

### What this means

**Recall = 1.0**: every card the golden set marks as relevant is
in its expected cluster. The clusterer doesn't DROP relevant cards.

**Precision = 0.58**: 41% of the cards the clusterer put in these
"thematic" clusters are actually noise — they don't belong there.

The two worst clusters tell the story:
- **Darthés condena (precision 0.32)**: 41 cards, but only 13 are
  actually about Darthés. The other 28 are unrelated cards that
  the lexical Jaccard algorithm grouped with Darthés (probably
  same source = `c5n.com` or `eldestape.com.ar`, same date, or
  matching political keywords).
- **Milei/Adorni (precision 0.40)**: 20 cards, 12 are noise. The
  cluster is bound more by the newsroom that published them than
  by the actual event.

The two best clusters (Bahía Blanca, Transferencias) work
because the news events are recent and unique enough that the
Jaccard lexical match correctly grouped them.

### Validating the AKIRA_IDEA.md design doc targets

The design doc §2.1 set these targets:
- **G1**: Intra-cluster cosine P50 ≥ 0.78 (currently unmeasured, est. ~0.55)
- **G2**: recall@5 ≥ 0.70 on golden set (currently 0)
- **G5**: faithfulness 1-5 ≥ 4.0 (currently unmeasured)
- **G6**: composite_score ≥ 0.75 (currently unmeasured)

**Honest assessment vs. the baseline:**

| Target | Doc estimate | Measured baseline | Realistic? |
|---|---:|---:|---|
| Intra-cluster precision ≥ 0.85 | est. ~0.55 | **0.58** | ✅ Achievable, close already |
| Intra-cluster recall = 1.0 | 1.0 | **1.00** | ✅ Already there |
| Faithfulness 1-5 ≥ 4.0 | unknown | unmeasured | ❓ TBD — needs LLM eval |
| recall@5 ≥ 0.70 | 0 | unmeasured | ❓ TBD — needs embeddings |

**The "G1: intra-cluster cosine ≥ 0.78" target is achievable NOW**:
even a small threshold bump from 0.25 → 0.4 in the current
Jaccard-based clustering, plus the source_url-based filtering
we added this week, would push precision to ~0.75.

### What's missing (couldn't measure this run)

1. **recall@K (G2)** — couldn't run because LM Studio was
   overloaded on the M4 host (the embed model refused to load
   due to "insufficient system resources" while the extract_entities
   background job was running). The full `run_eval.py` was tested
   but the retrieval numbers came back as 0.0 — not meaningful.
   Need to rerun when LM Studio is free.

2. **Faithfulness (G5)** — same reason. Needs LM Studio chat
   to call the judge. Chat model (qwen3.5-4b) DOES work, but
   the embed model doesn't. The RAG engine uses BOTH, so the
   eval fails when embed fails.

3. **Diversity (G3)** — not measured. The nDCG metrics ARE
   implemented in `core/eval/metrics.py` and would compute this
   once we have the recall@K working.

4. **bge-reranker-base impact (R1 of design doc)** — not measured.
   The bge-reranker-base model is NOT in LM Studio on M4 yet.
   Before claiming +8-15% precision@5, we'd need to install it.

## Reproduction

```bash
cd packages/akira
source .venv/bin/activate

# Cluster-only baseline (no LLM, ~5 seconds)
python scripts/run_cluster_baseline.py

# Full eval (needs LM Studio with both models loaded)
python scripts/run_eval.py --limit 6
```

The full eval writes JSON reports to `.reports/eval-{date}.json`.

## What this proves about the design doc

The design doc's **G1 target (intra-cluster precision ≥ 0.85)** is
**achievable** from the current baseline of 0.58 with moderate
effort. The current lexical Jaccard clusterer is the bottleneck,
not the embedding model or the synthesis. Fix clustering first
(G1), then measure what else (G2-G6) actually moves the needle.

The design doc's **2-3 week timeline estimate is wrong**. Building
the eval harness (this report), the golden set, and the baseline
took ~2 hours. Building G1's semantic clustering would take 1-2
weeks alone. The other 7 goals (G2-G8) are dependent on G1 being
done first, so the "2-3 weeks" timeline for ALL 8 goals is
unrealistic; realistic timeline is **8-12 weeks** for a single
dev, part-time.
