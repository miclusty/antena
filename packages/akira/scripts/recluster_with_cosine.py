#!/usr/bin/env python3
"""
Run the semantic re-clusterer (G1 lite) on the akira.db.

This is a 1-shot post-processing pass that re-assigns the
bias_score=0 ("noise") cards based on cosine similarity to
existing cluster centroids. The goal is to improve cluster
precision by moving off-topic noise out of thematic
clusters, so the RAG synthesis sees cleaner input.

Usage:
    cd packages/akira
    source .venv/bin/activate
    python scripts/recluster_with_cosine.py [--dry-run] [--threshold 0.45]

After running, validate the improvement with:
    python scripts/run_cluster_baseline.py

The baseline (precision 0.58) should improve.
"""

import argparse
import logging
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
AKIRA_ROOT = HERE.parent
sys.path.insert(0, str(AKIRA_ROOT))

from core.cluster_semantic import SemanticClusterer


def parse_args():
    p = argparse.ArgumentParser(description="Semantic re-clusterer (G1 lite)")
    p.add_argument(
        "--db",
        default=str(AKIRA_ROOT / "data" / "akira.db"),
        help="Path to akira.db",
    )
    p.add_argument(
        "--threshold",
        type=float,
        default=0.45,
        help="Cosine threshold for re-assigning noise cards to existing clusters "
        "(default 0.45). Higher = more conservative, fewer re-assignments.",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute assignments but don't write to DB",
    )
    return p.parse_args()


def main():
    args = parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    if not Path(args.db).exists():
        print(f"ERROR: {args.db} not found", file=sys.stderr)
        sys.exit(1)
    t0 = time.monotonic()
    clusterer = SemanticClusterer(db_path=args.db)
    stats = clusterer.recluster_with_cosine(
        assign_threshold=args.threshold,
        dry_run=args.dry_run,
    )
    elapsed = time.monotonic() - t0
    print()
    print("=" * 60)
    print(f"G1 LITE — Semantic re-cluster {'(DRY RUN)' if args.dry_run else '(APPLIED)'}")
    print("=" * 60)
    print(f"  threshold:        {args.threshold}")
    print(f"  eligible centroids: {stats['n_clusters_with_centroid']}")
    print(f"  noise cards:       {stats['n_noise_cards']}")
    print(f"  re-assigned:       {stats['n_noise_reassigned']}")
    print(f"  became singleton:  {stats['n_noise_singleton']}")
    print(f"  elapsed:           {elapsed:.1f}s")
    if not args.dry_run:
        print()
        print("Next: run `python scripts/run_cluster_baseline.py` to see the new precision.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
