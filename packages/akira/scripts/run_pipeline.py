#!/usr/bin/env python3
"""Run the full AKIRA pipeline in one go.

Steps (in order):
  1. Harvest:  fetch every active source's RSS/feed → insert into DB
  2. Cluster:  re-cluster all unclustered cards (v2 algorithm)
  3. Enrich:   backfill bias_score, category, quality_score, body

Usage:
    cd packages/akira
    source .venv/bin/activate
    python scripts/run_pipeline.py [--no-body] [--recluster] [--limit N]

Flags:
    --no-body    Skip the AKIRA /extract fetch for body (faster, but
                 no body field. Bias + category still get backfilled.)
    --recluster  Force re-clustering of ALL cards (not just new).
                 Use after upgrading the cluster algorithm or
                 changing the threshold.
    --limit N    Process at most N cards in the harvest step.
"""

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
AKIRA_ROOT = os.path.dirname(HERE)
sys.path.insert(0, AKIRA_ROOT)

# We call the standalone scripts as subprocesses to keep their
# own state (e.g. the harvest_run.py main()) isolated. This is
# simpler than re-implementing the harvest loop here.

SCRIPTS = HERE  # the scripts/ directory is where this file lives


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-body", action="store_true",
                        help="Skip the AKIRA /extract body fetch.")
    parser.add_argument("--recluster", action="store_true",
                        help="Re-cluster all cards (not just new).")
    parser.add_argument("--limit", type=int, default=None,
                        help="Limit harvest to N sources (for testing).")
    parser.add_argument("--skip-harvest", action="store_true",
                        help="Skip the harvest step (run only cluster+enrich).")
    parser.add_argument("--skip-cluster", action="store_true",
                        help="Skip the cluster step.")
    parser.add_argument("--skip-enrich", action="store_true",
                        help="Skip the enrich step.")
    args = parser.parse_args()

    # Need the venv active so subprocess python calls work the
    # same as the parent.
    venv_python = sys.executable

    if not args.skip_harvest:
        print("=" * 70)
        print("STEP 1/3: Harvest")
        print("=" * 70)
        os.system(
            f"AKIRA_API=http://localhost:5100/extract "
            f"{venv_python} {SCRIPTS}/harvest_run.py"
            + (f" --limit {args.limit}" if args.limit else "")
        )

    if not args.skip_cluster:
        print("=" * 70)
        print("STEP 2/3: Cluster")
        print("=" * 70)
        recluster_flag = "--recluster" if args.recluster else ""
        os.system(
            f"{venv_python} {SCRIPTS}/cluster_all_cards.py --batch-size 1000 {recluster_flag}"
        )

    if not args.skip_enrich:
        print("=" * 70)
        print("STEP 3/3: Enrich")
        print("=" * 70)
        no_body_flag = "--no-body" if args.no_body else ""
        os.system(
            f"{venv_python} {SCRIPTS}/enrich_cards.py {no_body_flag}"
        )

    print("=" * 70)
    print("Pipeline complete.")
    print("=" * 70)
    print("Next steps:")
    print("  1. Run `python scripts/sync_to_d1_remote.py` to push to D1 prod")
    print("  2. (Optional) Run master article synthesis if MINIMAX_API_KEY is set")


if __name__ == "__main__":
    main()
