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
  2. For each cluster (in parallel, --workers N):
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
    --workers N           Parallel workers (default 6, uses multi-Mac LM Studio LB)
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
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import List

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
    p.add_argument("--workers", type=int, default=6,
                   help="Parallel workers (default 6, uses multi-Mac LM Studio LB)")
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


def _process_cluster(
    cluster: dict,
    engine: "RAGEngine",
    judge,
    k_values,
    skip_synthesis: bool,
) -> dict:
    """Process one cluster end-to-end: assemble, retrieval metrics,
    synth, judge. Returns a record dict."""
    cid = cluster["cluster_id"]
    label = cluster.get("label", cid)
    relevant_ids = {c["id"] for c in cluster["cards"] if c.get("relevant")}
    irrelevant_ids = {c["id"] for c in cluster["cards"] if not c.get("relevant")}

    # Run RAG assemble
    t_assemble = time.monotonic()
    try:
        ctx = engine.assemble(cid)
    except Exception as e:
        return {"cluster_id": cid, "label": label, "error": f"assemble: {e}"}
    assemble_ms = int((time.monotonic() - t_assemble) * 1000)

    candidates = ctx.neighbor_ids
    all_cluster_card_ids = {a["id"] for a in ctx.cluster_articles}
    ooc_relevant = relevant_ids - all_cluster_card_ids

    retrieval_metrics = all_metrics(candidates, ooc_relevant, k_values=k_values)
    retrieval_metrics["latency_ms_assemble"] = assemble_ms
    retrieval_metrics["n_neighbor_returned"] = len(candidates)
    retrieval_metrics["n_relevant_in_cluster"] = len(relevant_ids & all_cluster_card_ids)
    retrieval_metrics["n_relevant_out_of_cluster"] = len(ooc_relevant)
    retrieval_metrics["n_irrelevant_in_cluster"] = len(irrelevant_ids & all_cluster_card_ids)

    # When there are no out-of-cluster relevant items, the
    # classical recall@K is unmeasurable. As a softer
    # signal, we compute "semantic overlap" between the
    # neighbors' titles and the in-cluster relevant titles.
    # This measures: are the KNN neighbors semantically close
    # to the cluster's core event, even though the golden set
    # has no out-of-cluster relevant to compare against?
    # Higher = better (neighbors "make sense" for this cluster).
    if relevant_ids & all_cluster_card_ids:
        import re
        import sqlite3 as _sq
        with _sq.connect(engine.db_path) as _conn:
            in_cluster_ids = list(relevant_ids & all_cluster_card_ids)
            placeholders = ",".join("?" * len(in_cluster_ids))
            rel_titles = [
                r[0] or ""
                for r in _conn.execute(
                    f"SELECT title FROM news_cards WHERE id IN ({placeholders})",
                    in_cluster_ids,
                ).fetchall()
            ]
            neighbor_titles = []
            for nid in candidates:
                row = _conn.execute(
                    "SELECT title FROM news_cards WHERE id=?", (nid,)
                ).fetchone()
                if row:
                    neighbor_titles.append(row[0] or "")
        if rel_titles and neighbor_titles:
            rel_tokens = set()
            for t in rel_titles:
                rel_tokens.update(re.findall(r"\b[a-záéíóúñ]{4,}\b", t.lower()))
            if rel_tokens:
                overlaps = []
                for nt in neighbor_titles:
                    nt_tokens = set(re.findall(r"\b[a-záéíóúñ]{4,}\b", nt.lower()))
                    overlaps.append(len(nt_tokens & rel_tokens))
                retrieval_metrics["semantic_overlap_in_cluster"] = {
                    "n_neighbors": len(neighbor_titles),
                    "n_relevant_in_cluster": len(in_cluster_ids),
                    "mean_overlap_tokens": sum(overlaps) / max(len(overlaps), 1),
                    "max_overlap_tokens": max(overlaps) if overlaps else 0,
                }

    record = {
        "cluster_id": cid,
        "label": label,
        "n_cluster_cards": len(ctx.cluster_articles),
        "retrieval": retrieval_metrics,
    }

    if skip_synthesis:
        return record

    # Synthesis
    t_synth = time.monotonic()
    try:
        synth = engine.synthesize(cid)
    except Exception as e:
        record["synthesis"] = {"latency_ms": int((time.monotonic() - t_synth) * 1000),
                              "judge": None, "error": f"synth: {e}"}
        return record
    synth_ms = int((time.monotonic() - t_synth) * 1000)

    if synth is None:
        record["synthesis"] = {"latency_ms": synth_ms, "judge": None, "error": "synth_returned_none"}
        return record

    master_dict = {
        "neutral": {"titulo": synth.neutral_title, "resumen": synth.neutral_summary},
        "pro_gov": {"titulo": synth.pro_gov_title, "resumen": synth.pro_gov_summary},
        "anti_gov": {"titulo": synth.anti_gov_title, "resumen": synth.anti_gov_summary},
    }
    chunks = [
        {
            "id": a["id"],
            "title": a.get("title", ""),
            "summary": a.get("summary", ""),
        }
        for a in ctx.cluster_articles[:30]
    ]
    judgment = None
    judge_ms = 0
    if judge is not None:
        t_judge = time.monotonic()
        judgment = judge.judge(master_dict, chunks)
        judge_ms = int((time.monotonic() - t_judge) * 1000)
    if judgment is not None:
        record["synthesis"] = {
            "latency_ms": synth_ms,
            "judge_ms": judge_ms,
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
        record["synthesis"] = {"latency_ms": synth_ms, "judge": None, "error": "judge_failed"}
    return record


def main():
    args = parse_args()
    if not args.quiet:
        print(f"Loading golden set from: {args.golden}")
    golden = load_golden_set(args.golden)
    if args.limit > 0:
        golden = golden[:args.limit]
    if not args.quiet:
        print(f"Loaded {len(golden)} clusters (workers={args.workers})")

    if not golden:
        print("ERROR: empty golden set", file=sys.stderr)
        sys.exit(1)

    # Initialize RAG engine (shared across workers)
    engine = RAGEngine(top_k=args.top_k)
    judge = SynthesisJudge() if not args.skip_synthesis else None
    if not args.quiet and judge is not None:
        print(f"LM Studio nodes active: {engine.lm.active_nodes()}")

    per_cluster: List[dict] = []
    t0 = time.monotonic()

    if args.workers <= 1:
        # Sequential path (preserves old print-on-each-step behavior)
        for i, cluster in enumerate(golden, 1):
            cid = cluster["cluster_id"]
            label = cluster.get("label", cid)
            if not args.quiet:
                print(f"\n[{i}/{len(golden)}] {label} ({cid})")
            record = _process_cluster(cluster, engine, judge, args.k, args.skip_synthesis)
            if "retrieval" in record and not args.quiet:
                m = record["retrieval"]
                print(f"  golden: {m['n_relevant_in_cluster'] + m['n_relevant_out_of_cluster']} relevant, "
                      f"{m['n_irrelevant_in_cluster']} irrelevant")
                print(f"  RAG neighbors: {m['n_neighbor_returned']} (assemble: {m['latency_ms_assemble']}ms)")
                print(f"  retrieval: {m.get('recall_at_5', 0):.2f} recall@5, "
                      f"{m.get('mrr', 0):.2f} MRR, "
                      f"{m.get('ndcg_at_5', 0):.2f} ndcg@5")
            if "synthesis" in record and record["synthesis"].get("judge") and not args.quiet:
                j = record["synthesis"]["judge"]
                print(f"  synth: {record['synthesis']['latency_ms']}ms, judge: {record['synthesis']['judge_ms']}ms, "
                      f"faith={j['faithfulness']}/5 src={j['source_coverage']}/5 bal={j['perspective_balance']}/5 "
                      f"unsup={j['unsupported_claims_count']}")
            per_cluster.append(record)
    else:
        # Parallel path: ThreadPoolExecutor. The RAG engine uses
        # the multi-Mac LM Studio LB internally, so 6 workers
        # saturate both Macs (3 per Mac) — the in-flight count
        # balancer in core/lmstudio.py distributes load.
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futures = {
                ex.submit(_process_cluster, cluster, engine, judge, args.k, args.skip_synthesis): cluster
                for cluster in golden
            }
            done = 0
            for fut in as_completed(futures):
                done += 1
                record = fut.result()
                cid = record.get("cluster_id", "?")
                label = record.get("label", cid)
                m = record.get("retrieval", {})
                synth_block = record.get("synthesis", {})
                j = synth_block.get("judge") if synth_block else None
                if not args.quiet:
                    msg = f"[{done}/{len(golden)}] {label[:40]:<40} "
                    if "error" in record and "retrieval" not in record:
                        msg += f"ERROR: {record['error']}"
                    else:
                        msg += (f"recall@5={m.get('recall_at_5', 0):.2f} "
                                f"mrr={m.get('mrr', 0):.2f} ")
                        if j:
                            msg += (f"faith={j['faithfulness']}/5 "
                                    f"src={j['source_coverage']}/5 "
                                    f"bal={j['perspective_balance']}/5")
                    print(msg, flush=True)
                per_cluster.append(record)
        # Sort by cluster_id for stable output
        per_cluster.sort(key=lambda r: r.get("cluster_id", ""))

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

    def _round_nested(d):
        out = {}
        for k, v in d.items():
            if isinstance(v, dict):
                out[k] = _round_nested(v)
            elif isinstance(v, (int, float)):
                out[k] = round(v, 4)
            else:
                out[k] = v
        return out

    report = {
        "date": datetime.now(timezone.utc).isoformat(),
        "model": "qwen3.5-4b",
        "n_clusters": len(per_cluster),
        "n_clusters_with_synthesis": sum(1 for r in per_cluster if r.get("synthesis", {}).get("judge")),
        "elapsed_seconds": round(elapsed, 1),
        "retrieval_metrics_aggregate": _round_nested(agg_retrieval),
        "synthesis_metrics_aggregate": _round_nested(agg_judge),
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
            if k.startswith("latency") or k.startswith("n_"):
                continue
            if isinstance(v, dict):
                print(f"  {k}:")
                for k2, v2 in v.items():
                    if isinstance(v2, (int, float)):
                        print(f"    {k2:>28}: {v2:.3f}")
            elif isinstance(v, (int, float)):
                print(f"  {k:>30}: {v:.3f}")
        if agg_judge:
            print(f"\nSynthesis (aggregate):")
            for k, v in agg_judge.items():
                if isinstance(v, (int, float)):
                    print(f"  {k:>30}: {v:.3f}")
        print(f"\nReport: {output_path}")
        print(f"Total: {elapsed:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
