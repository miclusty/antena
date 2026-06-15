#!/usr/bin/env python3
"""
Re-cluster ALL news cards from scratch using embeddings (cosine)
as the PRIMARY signal. Replaces the broken lexical-only
clusterer (clustering.py) which produced 26 over-clustered
groups of 11-20 unrelated articles (e.g. Mundial fútbol
grouped with Foodies + residuos electrónicos + choque + básquet).

Algorithm: single-linkage agglomerative clustering on cosine
similarity, with a hard threshold. For each card i, find the
card j with the highest cosine to i. If cosine > ASSIGN_THRESHOLD
(default 0.55) AND j doesn't already belong to a larger cluster,
merge i into j's cluster. This is O(n²) but vectorized with
numpy, so ~10-30s for 1100 cards.

The default threshold 0.55 is conservative — it merges
clear duplicates (cosine 0.7-0.9) but keeps paraphrased
coverage separate (cosine 0.3-0.5). Tune via the
run_cluster_baseline.py eval.

Cards without embeddings (very short summaries, edge cases)
fall back to the lexical signature. Without the lexical
fallback, the embedding-less cards would be singletons,
which over-inflates the cluster count.

After running, the existing master_articles for each cluster
will be stale (their cluster_id set changed). Re-run
synthesize.py / rag_synthesize.py to refresh.

Usage:
    cd packages/akira
    source .venv/bin/activate
    python scripts/recluster_all_semantic.py [--dry-run] [--threshold 0.55]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Set, Tuple

import numpy as np
import sqlite3

HERE = Path(__file__).resolve().parent
AKIRA_ROOT = HERE.parent
sys.path.insert(0, str(AKIRA_ROOT))

from core.db_helpers import get_db_connection
from core.clustering import (
    compute_title_signature, MIN_CLUSTER_SIZE, tokenize, merge_score,
)

logger = logging.getLogger("akira.recluster_semantic")

# Cosine threshold for merging two cards. Tuned via the
# run_cluster_baseline.py eval: 0.55 balances precision and
# recall. Lower = more clusters (over-merging risk); higher
# = more singletons (fragmentation risk).
DEFAULT_THRESHOLD = 0.55

# Lexical fallback threshold: only used for cards that don't
# have an embedding. Set to 0 (always make singleton) for
# strict semantic-only, or higher to allow the lexical
# clusterer to do its thing.
DEFAULT_LEXICAL_THRESHOLD = 0.30


def _normalize_vec(s: str | None) -> np.ndarray | None:
    """Parse a JSON-encoded 768-dim embedding vector. Returns
    None on parse error or empty input."""
    if not s:
        return None
    try:
        v = np.array(json.loads(s), dtype=np.float32)
        if v.size == 0 or np.linalg.norm(v) < 1e-9:
            return None
        return v
    except (json.JSONDecodeError, ValueError, TypeError):
        return None


def _cosine_matrix(vectors: np.ndarray) -> np.ndarray:
    """Return (N, N) cosine similarity matrix. Assumes vectors
    is (N, D) with each row already unit-normalized (callers
    must pre-normalize for speed)."""
    return vectors @ vectors.T


def _lexical_cluster_id(card_id: str) -> str:
    """Generate a cluster_id from a card id (used for the lexical
    fallback path so the id format matches what the previous
    clusterer produced)."""
    return hashlib.md5(f"lex-{card_id}".encode()).hexdigest()[:12]


def recluster_all_semantic(
    db_path: str,
    threshold: float = DEFAULT_THRESHOLD,
    lexical_threshold: float = DEFAULT_LEXICAL_THRESHOLD,
    dry_run: bool = False,
) -> Dict[str, int]:
    """Re-cluster every card using embeddings. Returns stats."""
    t0 = time.monotonic()
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        # Step 1: load all cards + their embeddings
        rows = conn.execute(
            """
            SELECT nc.id AS id, nc.title AS title, nc.summary AS summary,
                   ne.embedding AS embedding, nc.created_at AS created_at
            FROM news_cards nc
            LEFT JOIN news_embeddings ne ON ne.card_id = nc.id
            """
        ).fetchall()

        # Drop cards with no title/summary (would create noise)
        rows = [r for r in rows if r["title"] and r["summary"]]
        n_total = len(rows)
        n_with_emb = sum(1 for r in rows if r["embedding"])
        logger.info(
            "Loaded %d cards (%d with embeddings) in %.1fs",
            n_total, n_with_emb, time.monotonic() - t0,
        )

        # Step 2: build the card_id → index map
        ids = [r["id"] for r in rows]
        id_to_idx = {cid: i for i, cid in enumerate(ids)}

        # Step 3: build embedding matrix (with zeros for missing)
        DIM = 768
        emb_matrix = np.zeros((n_total, DIM), dtype=np.float32)
        has_emb = np.zeros(n_total, dtype=bool)
        for i, r in enumerate(rows):
            v = _normalize_vec(r["embedding"])
            if v is not None and v.size == DIM:
                emb_matrix[i] = v
                has_emb[i] = True

        # Step 4: pre-normalize for fast cosine
        norms = np.linalg.norm(emb_matrix, axis=1, keepdims=True)
        # Avoid division by zero for the all-zero rows
        norms = np.where(norms < 1e-9, 1.0, norms)
        emb_norm = emb_matrix / norms

        # Step 5: full cosine matrix
        logger.info("Computing %dx%d cosine matrix…", n_total, n_total)
        cos_t = time.monotonic()
        cos_full = emb_norm @ emb_norm.T  # (N, N)
        # Zero out self-similarity to avoid trivial merges
        np.fill_diagonal(cos_full, 0.0)
        # Zero out cross-similarity for rows without embeddings
        # so they always become singletons (unless the lexical
        # fallback matches them up later)
        no_emb_mask = ~has_emb
        cos_full[no_emb_mask, :] = 0.0
        cos_full[:, no_emb_mask] = 0.0
        logger.info("Cosine matrix in %.1fs", time.monotonic() - cos_t)

        # Step 6: greedy single-linkage clustering.
        # For each card i, find the card j with the highest
        # cosine to i (j != i). If cosine > threshold AND the
        # j-card hasn't been merged into a cluster that would
        # exceed 50 cards (a soft cap to prevent runaway
        # clusters), assign i to j's cluster.
        # We use union-find for O(α(n)) merges.
        parent = list(range(n_total))
        rank = [0] * n_total
        cluster_max_size = 50  # soft cap per cluster

        def find(x: int) -> int:
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a: int, b: int) -> int:
            ra, rb = find(a), find(b)
            if ra == rb:
                return ra
            if rank[ra] < rank[rb]:
                ra, rb = rb, ra
            parent[rb] = ra
            if rank[ra] == rank[rb]:
                rank[ra] += 1
            return ra

        cluster_size: Dict[int, int] = {i: 1 for i in range(n_total)}

        # Sort all (i, j) pairs by cosine descending so we merge
        # the most similar pairs first. This is what makes
        # single-linkage work well with a threshold.
        # For efficiency we use argpartition on the upper triangle.
        logger.info("Finding best matches…")
        # Mask out the lower triangle + diagonal to avoid duplicates
        mask = np.triu(np.ones_like(cos_full, dtype=bool), k=1)
        flat_cos = cos_full[mask]
        flat_idx = np.argwhere(mask)
        # Sort descending
        order = np.argsort(-flat_cos)
        n_pairs = len(order)
        n_merged = 0
        for k in order:
            if k >= n_pairs:
                break
            i, j = flat_idx[k]
            sim = flat_cos[k]
            if sim < threshold:
                break  # remaining pairs are below threshold
            ri, rj = find(i), find(j)
            if ri == rj:
                continue
            # Soft cap: don't merge if either cluster is already too big
            if cluster_size[ri] >= cluster_max_size or cluster_size[rj] >= cluster_max_size:
                continue
            new_root = union(ri, rj)
            cluster_size[new_root] = cluster_size[ri] + cluster_size[rj]
            n_merged += 1

        logger.info(
            "Merged %d pairs (threshold=%.2f, ~%.1fs)",
            n_merged, threshold, time.monotonic() - t0,
        )

        # Step 7: cluster_id = md5 of (sorted members)[:12] for
        # stable IDs across re-runs. Members that end up as
        # singletons keep their current cluster_id OR get a
        # new lexical-fallback id (for cards without embeddings).
        cluster_to_members: Dict[int, List[int]] = {}
        for i in range(n_total):
            r = find(i)
            cluster_to_members.setdefault(r, []).append(i)

        # Step 8: produce cluster_id mapping (id → new_cluster_id)
        # For multi-card clusters, the cluster_id is the md5
        # of the sorted member ids (so re-runs produce the same
        # id). For singletons, keep the existing id if it has an
        # embedding OR generate a fresh lexical id.
        new_cluster_ids: List[str] = [""] * n_total
        cluster_id_pool: Dict[str, int] = {}  # for collision detection
        for root, members in cluster_to_members.items():
            if len(members) >= 2:
                members_sorted = sorted(members)
                members_csv = ",".join(ids[i] for i in members_sorted)
                cid = hashlib.md5(members_csv.encode()).hexdigest()[:12]
            else:
                # Singleton
                i = members[0]
                if has_emb[i]:
                    # Stable id: hash of the card_id
                    cid = hashlib.md5(f"emb-{ids[i]}".encode()).hexdigest()[:12]
                else:
                    # No embedding: use lexical signature
                    sig = compute_title_signature(rows[i]["title"])
                    if sig:
                        cid = hashlib.md5(sig.encode()).hexdigest()[:12]
                    else:
                        cid = _lexical_cluster_id(ids[i])
            for i in members:
                new_cluster_ids[i] = cid

        # Build the new assignments
        assignments = list(zip(ids, new_cluster_ids))

        # Step 9: lexical fallback pass for cards that ended
        # up as singletons with no embedding — try to merge
        # them into existing semantic clusters if their title
        # is lexically similar (token Jaccard > lexical_threshold).
        # Without this, a card with no embedding would be its
        # own cluster even if it's a clear duplicate of a
        # semantically-clustered card.
        if lexical_threshold > 0:
            # Build the token sets for cards with embeddings
            # (these are the "canon" of each cluster)
            cluster_token_centroid: Dict[str, Set[str]] = {}
            for root, members in cluster_to_members.items():
                if len(members) < 2:
                    continue
                # Average the title tokens of all members
                toks: Set[str] = set()
                for i in members:
                    toks |= tokenize(rows[i]["title"])
                cid = new_cluster_ids[members[0]]
                cluster_token_centroid[cid] = toks

            for i in range(n_total):
                if has_emb[i] or new_cluster_ids[i] in cluster_token_centroid:
                    continue
                # Singleton, no embedding
                toks_i = tokenize(rows[i]["title"])
                if not toks_i:
                    continue
                best_cid = None
                best_score = 0.0
                for cid, toks_c in cluster_token_centroid.items():
                    if not toks_c:
                        continue
                    inter = len(toks_i & toks_c)
                    union = len(toks_i | toks_c)
                    if union == 0:
                        continue
                    score = inter / union
                    if score > best_score:
                        best_score = score
                        best_cid = cid
                if best_cid and best_score >= lexical_threshold:
                    new_cluster_ids[i] = best_cid

        # Re-assign — for cards that the lexical pass merged,
        # update assignments
        assignments = list(zip(ids, new_cluster_ids))

        # Step 10: write to DB (unless dry run)
        if not dry_run:
            # Update cluster_id for all cards in a single transaction
            # for speed
            logger.info("Writing %d cluster_id updates to DB…", len(assignments))
            with conn:
                conn.executemany(
                    "UPDATE news_cards SET cluster_id = ? WHERE id = ?",
                    [(cid, cid_) for cid_, cid in assignments],
                )

    # Compute final stats
    cluster_sizes: Dict[str, int] = {}
    for _, cid in assignments:
        cluster_sizes[cid] = cluster_sizes.get(cid, 0) + 1
    size_dist: Dict[int, int] = {}
    for s in cluster_sizes.values():
        size_dist[s] = size_dist.get(s, 0) + 1
    singletons = size_dist.get(1, 0)
    small_clusters = sum(c for s, c in size_dist.items() if 2 <= s <= 5)
    big_clusters = sum(c for s, c in size_dist.items() if s > 5)

    stats = {
        "n_cards": len(assignments),
        "n_with_embeddings": n_with_emb,
        "n_merges": n_merged,
        "n_singleton_clusters": singletons,
        "n_small_clusters_2_5": small_clusters,
        "n_big_clusters_6plus": big_clusters,
        "n_total_clusters": len(cluster_sizes),
        "elapsed_s": time.monotonic() - t0,
    }
    return stats


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=str(AKIRA_ROOT / "data" / "akira.db"))
    parser.add_argument(
        "--threshold", type=float, default=DEFAULT_THRESHOLD,
        help="Cosine threshold for merging cards (default 0.55).",
    )
    parser.add_argument(
        "--lexical-threshold", type=float, default=DEFAULT_LEXICAL_THRESHOLD,
        help="Jaccard threshold for the lexical fallback pass (default 0.30).",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    if not Path(args.db).exists():
        print(f"ERROR: {args.db} not found", file=sys.stderr)
        return 1
    stats = recluster_all_semantic(
        db_path=args.db,
        threshold=args.threshold,
        lexical_threshold=args.lexical_threshold,
        dry_run=args.dry_run,
    )
    print()
    print("=" * 60)
    print(f"SEMANTIC RECLUSTER {'(DRY RUN)' if args.dry_run else '(APPLIED)'}")
    print("=" * 60)
    for k, v in stats.items():
        print(f"  {k:25s} {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
