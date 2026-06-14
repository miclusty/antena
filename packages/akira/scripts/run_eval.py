#!/usr/bin/env python3
"""
AKIRA RAG eval harness — measures the BASELINE quality of the
existing 3-stage retriever and 1-pass synthesis, against a
hand-curated golden set of 6 clusters (data/golden_set.jsonl).

This is the FIRST measurement. It tells us whether the design
doc's targets (recall@5 ≥ 0.70, faithfulness ≥ 4.0, etc) are
realistic given the current system, or aspirational.

What it does:
  1. Load the golden set
  2. For each cluster:
     a. Run RAGEngine.assemble() to get the KNN neighbors
     b. Compute retrieval metrics: recall@5/10, MRR, nDCG, hit_rate
     c. Run RAGEngine.synthesize() to get the 3 perspectives
     d. Run SynthesisJudge.judge() to rate the synthesis
  3. Aggregate metrics across clusters
  4. Write JSON report to .reports/eval-{date}.json

CLI:
    --golden PATH         Path to golden_set.jsonl (default: data/golden_set.jsonl)
    --k 5 10 20           K values for recall@K (default: 5 10 20)
    --top-k N             Top-K neighbors from RAG (default: 5)
    --skip-synthesis      Only measure retrieval, skip synthesis + judge
    --limit N             Only first N clusters of the golden set
    --output PATH         Output JSON report path (default: auto-generated)

Why this matters:
  - Design doc §2.1 sets targets: recall@5 ≥ 0.70, faithfulness ≥ 4.0
  - But there's no baseline. We can't tell if the targets are
    achievable or aspirational until we measure.
  - The numbers from THIS script become the baseline. Future
    improvements (semantic clustering, cross-encoder rerank,
    3-pass synthesis) are evaluated against THIS baseline.
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
AKIRA_ROOT = HERE.parent
sys.path.insert(0, str(AKIRA_ROOT))

from core.eval.metrics import all_metrics, aggregate
from core.eval.judge import SynthesisJudge, Judgment
from core.rag import RAGEngine


def parse_args():
    p = argparse.ArgumentParser(description="AKIRA RAG eval harness")
    p.add_argument("--golden", default=str(AKIRA_ROOT / "data" / "golden_set.jsonl"))
    p.add_argument("--k", type=int, nargs="+", default=[5, 10, 20],
                   help="K values for recall@K")
    p.add_argument("--top-k", type=int, default=5, help="KNN top-K from RAG")
    p.add_argument("--skip-synthesis", action="store_true",
                   help="Only measure retrieval, skip synthesis + judge")
    p.add_argument("--limit", type=int, default=0, help="Limit to first N clusters")
    p.add_argument("--output", default=None, help="Output JSON path")
    p.add_argument("--quiet", action="store_true", help="Less verbose")
    return p.parse_args()


def load_golden_set(path: str) -> list:
    """Load JSONL. Each line is a cluster object with `cards`,
    where each card has `id` and `relevant` boolean."""
    clusters = []
    with open(path) as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                cluster = json.loads(line)
                clusters.append(cluster)
            except json.JSONDecodeError as e:
                print(f"  WARN: line {line_num} invalid JSON: {e}", file=sys.stderr)
    return clusters


def get_cluster_articles_from_db(cluster_id: str, db_path: str) -> list:
    """Fetch all cards in a cluster, in cluster_id's natural
    order (published_at DESC). Returns list of dicts with
    id, title, summary, source_id, source_name."""
    import sqlite3
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT nc.id, nc.title, nc.summary, nc.source_ids, nc.bias_score,
                   COALESCE(s.name, '') AS source_name
            FROM news_cards nc
            LEFT JOIN sources s ON s.id = CAST(SUBSTR(nc.source_ids, 1, INSTR(nc.source_ids || ',', ',') - 1) AS INTEGER)
            WHERE nc.cluster_id = ? AND nc.summary IS NOT NULL
              AND LENGTH(nc.summary) > 30
            ORDER BY nc.published_at DESC
            """,
            (cluster_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def main():
    args = parse_args()
    if not args.quiet:
        print(f"Loading golden set from: {args.golden}")
    golden = load_golden_set(args.golden)
    if args.limit > 0:
        golden = golden[:args.limit]
    if not args.quiet:
        print(f"Loaded {len(golden)} clusters")

    if not golden:
        print("ERROR: empty golden set", file=sys.stderr)
        sys.exit(1)

    # Initialize RAG engine
    engine = RAGEngine(top_k=args.top_k)
    judge = SynthesisJudge() if not args.skip_synthesis else None

    db_path = engine.db_path
    per_cluster = []
    t0 = time.monotonic()

    for i, cluster in enumerate(golden, 1):
        cid = cluster["cluster_id"]
        label = cluster.get("label", cid)
        if not args.quiet:
            print(f"\n[{i}/{len(golden)}] {label} ({cid})")
        # Map golden to (relevant_ids, irrelevant_ids)
        relevant_ids = {c["id"] for c in cluster["cards"] if c.get("relevant")}
        irrelevant_ids = {c["id"] for c in cluster["cards"] if not c.get("relevant")}
        if not args.quiet:
            print(f"  golden: {len(relevant_ids)} relevant, {len(irrelevant_ids)} irrelevant")

        # Run RAG assemble to get the KNN neighbors
        t_assemble = time.monotonic()
        try:
            ctx = engine.assemble(cid)
        except Exception as e:
            print(f"  ERROR assemble: {e}", file=sys.stderr)
            continue
        assemble_ms = int((time.monotonic() - t_assemble) * 1000)

        # The RAG engine returns up to top_k neighbors. We treat
        # them as the "candidates" set. For retrieval metrics,
        # we want to know: of the relevant items, how many did
        # we surface? How high in our ranking?
        candidates = ctx.neighbor_ids
        if not args.quiet:
            print(f"  RAG neighbors: {len(candidates)} (assemble: {assemble_ms}ms)")

        # Compute retrieval metrics.
        # Note: RAG excludes cards from the SAME cluster (we
        # don't return what's already in the cluster as a
        # "neighbor" — that would be trivial). So for recall,
        # the relevant set is restricted to cards NOT in the
        # same cluster_id.
        # But our golden set marks some cards as relevant AND
        # they ARE in the cluster (e.g. Darthés cluster has
        # 12 Darthés cards). For those, RAG excluding them is
        # correct — they shouldn't be "neighbors" of themselves.
        # So: split relevant into "in_cluster_relevant" and
        # "out_of_cluster_relevant", and only score the latter.
        all_cluster_card_ids = {a["id"] for a in ctx.cluster_articles}
        ooc_relevant = relevant_ids - all_cluster_card_ids
        if not args.quiet:
            print(f"  relevant: {len(relevant_ids)} total, {len(ooc_relevant)} out-of-cluster (only these can be 'retrieved')")

        retrieval_metrics = all_metrics(candidates, ooc_relevant, k_values=args.k)
        retrieval_metrics["latency_ms_assemble"] = assemble_ms
        retrieval_metrics["n_neighbor_returned"] = len(candidates)
        retrieval_metrics["n_relevant_in_cluster"] = len(relevant_ids & all_cluster_card_ids)
        retrieval_metrics["n_relevant_out_of_cluster"] = len(ooc_relevant)
        retrieval_metrics["n_irrelevant_in_cluster"] = len(irrelevant_ids & all_cluster_card_ids)

        if not args.quiet:
            print(f"  retrieval: {retrieval_metrics.get('recall_at_5', 0):.2f} recall@5, "
                  f"{retrieval_metrics.get('mrr', 0):.2f} MRR, "
                  f"{retrieval_metrics.get('ndcg_at_5', 0):.2f} ndcg@5")

        record = {
            "cluster_id": cid,
            "label": label,
            "n_cluster_cards": len(ctx.cluster_articles),
            "retrieval": retrieval_metrics,
        }

        # Synthesis + judge
        if not args.skip_synthesis:
            t_synth = time.monotonic()
            try:
                synth = engine.synthesize(cid)
            except Exception as e:
                print(f"  ERROR synth: {e}", file=sys.stderr)
                synth = None
            synth_ms = int((time.monotonic() - t_synth) * 1000)

            if synth is not None:
                # Build master_article dict for the judge
                master_dict = {
                    "neutral": {"titulo": synth.neutral_title, "resumen": synth.neutral_summary},
                    "pro_gov": {"titulo": synth.pro_gov_title, "resumen": synth.pro_gov_summary},
                    "anti_gov": {"titulo": synth.anti_gov_title, "resumen": synth.anti_gov_summary},
                }
                # Cluster chunks for the judge: use the
                # representative_text-relevant top-30 cards.
                chunks = [
                    {
                        "id": a["id"],
                        "title": a.get("title", ""),
                        "summary": a.get("summary", ""),
                    }
                    for a in ctx.cluster_articles[:30]
                ]
                # Run judge (defensive: skip_synthesis is already False here)
                judgment = None
                judge_ms = 0
                if judge is not None:
                    t_judge = time.monotonic()
                    judgment = judge.judge(master_dict, chunks)
                    judge_ms = int((time.monotonic() - t_judge) * 1000)
                if not args.quiet and judgment is not None:
                    print(f"  synth: {synth_ms}ms, judge: {judge_ms}ms, "
                          f"faith={judgment.faithfulness}/5 "
                          f"src={judgment.source_coverage}/5 "
                          f"bal={judgment.perspective_balance}/5 "
                          f"unsup={len(judgment.unsupported_claims)}")
                if judgment is not None:
                    record["synthesis"] = {
                        "latency_ms": synth_ms,
                        "judge": {
                            "faithfulness": judgment.faithfulness,
                            "source_coverage": judgment.source_coverage,
                            "perspective_balance": judgment.perspective_balance,
                            "unsupported_claims_count": len(judgment.unsupported_claims),
                            "composite": round(judgment.composite(), 3),
                            "reasoning": judgment.reasoning,
                        },
                    }
                else:
                    record["synthesis"] = {"latency_ms": synth_ms, "judge": None, "error": "judge_failed_or_skipped"}
            else:
                record["synthesis"] = {"latency_ms": synth_ms, "judge": None, "error": "synth_failed"}

        per_cluster.append(record)

    elapsed = time.monotonic() - t0

    # Aggregate
    retrieval_per = [r["retrieval"] for r in per_cluster if "retrieval" in r]
    agg_retrieval = aggregate(retrieval_per)

    judge_per = []
    for r in per_cluster:
        synth_block = r.get("synthesis") or {}
        j = synth_block.get("judge") if synth_block else None
        if j and j.get("faithfulness", 0) > 0:
            judge_per.append({
                "faithfulness": j["faithfulness"],
                "source_coverage": j["source_coverage"],
                "perspective_balance": j["perspective_balance"],
                "unsupported_claims_count": j["unsupported_claims_count"],
                "composite": j["composite"],
            })
    agg_judge = aggregate(judge_per) if judge_per else {}

    # Compose the final report
    out_dir = AKIRA_ROOT / ".reports"
    out_dir.mkdir(exist_ok=True)
    if args.output:
        output_path = Path(args.output)
    else:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        output_path = out_dir / f"eval-{stamp}.json"

    report = {
        "date": datetime.now(timezone.utc).isoformat(),
        "model": "qwen3.5-4b",
        "n_clusters": len(per_cluster),
        "n_clusters_with_synthesis": sum(1 for r in per_cluster if r.get("synthesis", {}).get("judge")),
        "elapsed_seconds": round(elapsed, 1),
        "retrieval_metrics_aggregate": {k: round(v, 4) for k, v in agg_retrieval.items()},
        "synthesis_metrics_aggregate": {k: round(v, 4) for k, v in agg_judge.items()},
        "per_cluster": per_cluster,
        "design_doc_targets": {
            "G1_intra_cluster_cosine_p50": {"target": 0.78, "measured_here": False,
                "note": "requires cluster_centroids table; not in v1 baseline"},
            "G2_recall_at_5": {"target": 0.70, "measured_here": True},
            "G3_neighbor_pair_cosine_p90": {"target": 0.92, "measured_here": False,
                "note": "lower is better; this is a diversity metric"},
            "G4_recall_at_10": {"target": "+10% over plain", "measured_here": True},
            "G5_faithfulness": {"target": 4.0, "measured_here": True},
            "G6_composite_score": {"target": 0.75, "measured_here": True},
        },
    }
    with open(output_path, "w") as f:
        json.dump(report, f, ensure_ascii=False, indent=2, default=str)
    if not args.quiet:
        print(f"\n\n=== BASELINE RESULTS ({len(per_cluster)} clusters) ===")
        print(f"Retrieval (aggregate):")
        for k, v in agg_retrieval.items():
            if not k.startswith("latency") and not k.startswith("n_"):
                print(f"  {k:>30}: {v:.3f}")
        if agg_judge:
            print(f"\nSynthesis (aggregate):")
            for k, v in agg_judge.items():
                print(f"  {k:>30}: {v:.3f}")
        print(f"\nReport: {output_path}")
        print(f"Total: {elapsed:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
