#!/usr/bin/env python3
"""Run the full AKIRA pipeline in one go.

Steps (in order):
  1. Harvest:    fetch every active source's RSS/feed → insert into DB
  2. Cluster:    re-cluster all unclustered cards (v2 algorithm)
  3. Enrich:     backfill bias_score, category, quality_score, body
  4. Embed:      compute 768-dim vector for each card (vector store)
  5. Entities:   LLM-extract entities from each card (knowledge base)
  6. KB:         compute entity co-occurrence graph
  7. Synthesize: generate 3 RAG perspectives per cluster (master article)

Usage:
    cd packages/akira
    source .venv/bin/activate
    python scripts/run_pipeline.py [--no-body] [--recluster] [--limit N]

Flags:
    --no-body    Skip the AKIRA /extract fetch for body (faster).
    --recluster  Force re-clustering of ALL cards.
    --limit N    Process at most N sources in the harvest step.
    --workers N  Concurrent workers for the LM Studio scripts
                 (default 12 = 6 per node on M4 + M5).
    --skip-*     Skip any individual step.

The 4 RAG steps (4-7) are NEW (Day 1-5 of the LMWIKI project).
They use a multi-node LM Studio client that round-robins across
localhost (M4) and the LAN-attached M5. Set AKIRA_LMSTUDIO_NODES
to override the default.

Each step is a standalone script invoked as a subprocess — that
keeps their own state isolated and lets us run them individually
in production if needed.
"""

import argparse
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
AKIRA_ROOT = os.path.dirname(HERE)
sys.path.insert(0, AKIRA_ROOT)

SCRIPTS = HERE


def step(title, cmd, env=None):
    """Run a pipeline step. Returns (returncode, elapsed_seconds).

    Uses subprocess.run with shell=True so multi-word commands (with env-var
    prefixes) work the same way os.system did. We don't check=True because
    the pipeline continues on per-step failure and reports at the end.
    """
    print()
    print("=" * 70)
    print(f"STEP: {title}")
    print("=" * 70)
    print(f"  cmd: {cmd}")
    print()
    t0 = time.monotonic()
    full_env = os.environ.copy()
    if env:
        full_env.update(env)
    result = subprocess.run(
        cmd,
        shell=True,
        env=full_env,
        capture_output=True,
        text=True,
    )
    elapsed = time.monotonic() - t0
    # Stream the child process's output so failures are visible.
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    print(f"\n[{title}] exit={result.returncode} elapsed={elapsed:.1f}s")
    return result.returncode, elapsed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-body", action="store_true",
                        help="Skip the AKIRA /extract body fetch.")
    parser.add_argument("--recluster", action="store_true",
                        help="Re-cluster all cards (not just new).")
    parser.add_argument("--limit", type=int, default=None,
                        help="Limit harvest to N sources (for testing).")
    parser.add_argument("--workers", type=int, default=12,
                        help="Concurrent workers for embed/extract/synth (default 12).")
    parser.add_argument("--skip-harvest", action="store_true")
    parser.add_argument("--skip-cluster", action="store_true")
    parser.add_argument("--skip-enrich", action="store_true")
    parser.add_argument("--skip-embed", action="store_true",
                        help="Skip vector embedding step.")
    parser.add_argument("--skip-entities", action="store_true",
                        help="Skip entity extraction step.")
    parser.add_argument("--skip-kb", action="store_true",
                        help="Skip knowledge-base graph build.")
    parser.add_argument("--skip-synth", action="store_true",
                        help="Skip RAG master-article synthesis.")
    parser.add_argument("--synth-limit", type=int, default=0,
                        help="Max clusters to synthesize (0 = all).")
    args = parser.parse_args()

    venv_python = sys.executable
    workers = args.workers
    print(f"Pipeline: workers={workers} (distributed across M4 + M5)")

    total_t0 = time.monotonic()
    steps_done = []
    steps_skipped = []

    # ─── Step 1: Harvest ────────────────────────────────────────────
    if not args.skip_harvest:
        cmd = (
            f"AKIRA_API=http://localhost:5100/extract "
            f"{venv_python} {SCRIPTS}/harvest_run.py"
            + (f" --limit {args.limit}" if args.limit else "")
        )
        rc, _ = step("1/7 Harvest", cmd)
        steps_done.append("harvest" if rc == 0 else f"harvest(failed={rc})")
    else:
        steps_skipped.append("harvest")

    # ─── Step 2: Cluster ────────────────────────────────────────────
    if not args.skip_cluster:
        recluster_flag = "--recluster" if args.recluster else ""
        cmd = f"{venv_python} {SCRIPTS}/cluster_all_cards.py --batch-size 1000 {recluster_flag}"
        rc, _ = step("2/7 Cluster", cmd)
        steps_done.append("cluster" if rc == 0 else f"cluster(failed={rc})")
    else:
        steps_skipped.append("cluster")

    # ─── Step 3: Enrich ─────────────────────────────────────────────
    if not args.skip_enrich:
        no_body_flag = "--no-body" if args.no_body else ""
        cmd = f"{venv_python} {SCRIPTS}/enrich_cards.py {no_body_flag}"
        rc, _ = step("3/7 Enrich", cmd)
        steps_done.append("enrich" if rc == 0 else f"enrich(failed={rc})")
    else:
        steps_skipped.append("enrich")

    # ─── Step 4: Embed (vector store) ───────────────────────────────
    if not args.skip_embed:
        cmd = f"{venv_python} {SCRIPTS}/embed_cards.py --workers {workers}"
        rc, _ = step("4/7 Embed (vectors)", cmd)
        steps_done.append("embed" if rc == 0 else f"embed(failed={rc})")
    else:
        steps_skipped.append("embed")

    # ─── Step 5: Entities (LLM extraction) ──────────────────────────
    if not args.skip_entities:
        cmd = f"{venv_python} {SCRIPTS}/extract_entities.py --workers {workers}"
        rc, _ = step("5/7 Entities (LLM)", cmd)
        steps_done.append("entities" if rc == 0 else f"entities(failed={rc})")
    else:
        steps_skipped.append("entities")

    # ─── Step 6: Knowledge Base graph ───────────────────────────────
    if not args.skip_kb:
        cmd = f"{venv_python} {SCRIPTS}/build_kb.py"
        rc, _ = step("6/7 KB graph", cmd)
        steps_done.append("kb" if rc == 0 else f"kb(failed={rc})")
    else:
        steps_skipped.append("kb")

    # ─── Step 7: RAG Synthesis ──────────────────────────────────────
    if not args.skip_synth:
        limit_flag = f"--limit {args.synth_limit}" if args.synth_limit else ""
        cmd = f"{venv_python} {SCRIPTS}/rag_synthesize.py --workers {workers} {limit_flag}"
        rc, _ = step("7/7 RAG Synthesize", cmd)
        steps_done.append("synth" if rc == 0 else f"synth(failed={rc})")
    else:
        steps_skipped.append("synth")

    total_elapsed = time.monotonic() - total_t0

    print()
    print("=" * 70)
    print("Pipeline complete.")
    print("=" * 70)
    print(f"Total: {total_elapsed/60:.1f}min")
    print(f"Done:   {', '.join(steps_done)}")
    if steps_skipped:
        print(f"Skipped: {', '.join(steps_skipped)}")
    print()
    print("Next steps:")
    print("  1. Run `python scripts/sync_to_d1_remote.py` to push to D1 prod")
    print("  2. Verify RAG output: GET /synthesis/master/{cluster_id}")


if __name__ == "__main__":
    main()
