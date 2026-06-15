#!/usr/bin/env python3
"""
Re-cluster ALL news cards from scratch using embeddings (cosine)
as the PRIMARY signal. Replaces the broken lexical-only
clusterer (clustering.py) which produced 26 over-clustered
groups of 11-20 unrelated articles (e.g. Mundial fútbol
grouped with Foodies + residuos electrónicos + choque + básquet).

Algorithm: HDBSCAN (density-based) on the cosine distance
matrix. HDBSCAN finds dense regions of high-similarity cards
and labels sparse cards as outliers (-1). This naturally
gives us:
  - Tight per-event clusters (2-5 cards that ARE about the
    same event)
  - Outliers (singletons) for cards that don't cluster with
    anyone — which is the CORRECT outcome for one-off stories
  - NO more giant 20-card over-clusters (HDBSCAN refuses to
    form a cluster unless the density is high enough)

Why HDBSCAN over single-linkage (the previous v1 of this
script):
  - HDBSCAN finds variable-density clusters. A real news event
    covered by 3 sources + 1 outlier is 1 cluster + 1 outlier,
    not 1 cluster of 4 (where the 4th is unrelated).
  - HDBSCAN's 'min_cluster_size' parameter is intuitive:
    "I want at least N cards to be a real cluster, otherwise
    they're noise." Default 3 = clusters of 3+ are real,
    1-2 are singletons.
  - Soft cluster cap of 50 cards prevents any single cluster
    from growing huge even if HDBSCAN's natural density would
    allow it (safety net).

Cards without embeddings (very short summaries, edge cases)
fall back to the single-linkage cosine pass from v1, then
lexical signature if no embedding. The combined approach
guarantees every card gets a cluster_id, and outliers
(HDBSCAN label -1) become singletons.

After running, master_articles (the RAG synthesis output) will
be stale (their cluster_id set changed). Re-run rag_synthesize
or the synthesis pipeline step to refresh.

Usage:
    cd packages/akira
    source .venv/bin/activate
    python scripts/recluster_all_semantic.py [--dry-run] [--min-cluster 3]
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

# Minimum number of cards to form a real cluster in HDBSCAN.
# Below this they're outliers (singletons). The 3 here is
# intentional: a 3-card cluster usually means 3 sources
# covering the same event (Mundial, etc.). A 1-2 card
# "cluster" is more often coincidence than coverage.
DEFAULT_MIN_CLUSTER = 3

# HDBSCAN's min_samples parameter (controls how conservative
# the density estimate is). Higher = more outliers.
DEFAULT_MIN_SAMPLES = 2

# Soft cap on cluster size. HDBSCAN's natural density
# sometimes produces a 200-card cluster if the corpus is
# dominated by similar articles. Cap it at 50 to force the
# remaining to break out into their own sub-events.
DEFAULT_MAX_CLUSTER = 50

# Cosine threshold for the single-linkage fallback (cards
# without embeddings). Default 0.45 = merge if very similar.
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
    min_cluster: int = DEFAULT_MIN_CLUSTER,
    min_samples: int = DEFAULT_MIN_SAMPLES,
    max_cluster: int = DEFAULT_MAX_CLUSTER,
    lexical_threshold: float = DEFAULT_LEXICAL_THRESHOLD,
    dry_run: bool = False,
) -> Dict[str, int]:
    """Re-cluster every card using HDBSCAN on embeddings. Returns stats."""
    import hdbscan

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

        # Step 3: build embedding matrix
        DIM = 768
        emb_matrix = np.zeros((n_total, DIM), dtype=np.float32)
        has_emb = np.zeros(n_total, dtype=bool)
        for i, r in enumerate(rows):
            v = _normalize_vec(r["embedding"])
            if v is not None and v.size == DIM:
                emb_matrix[i] = v
                has_emb[i] = True

        # Step 4: pre-normalize for cosine
        norms = np.linalg.norm(emb_matrix, axis=1, keepdims=True)
        norms = np.where(norms < 1e-9, 1.0, norms)
        emb_norm = emb_matrix / norms

        # Step 5: HDBSCAN with cosine metric.
        # - metric='cosine' uses 1 - cos as the distance (HDBSCAN
        #   wants distances, not similarities).
        # - min_cluster_size=N: clusters of <N are noise.
        # - min_samples=M: how conservative the density estimate
        #   is. Higher = more noise (more singletons).
        # - cluster_selection_method='leaf': favors smaller,
        #   tighter clusters (the alternative 'eom' tends to
        #   produce one giant cluster + many noise points).
        logger.info(
            "HDBSCAN (min_cluster=%d, min_samples=%d)…", min_cluster, min_samples,
        )
        hdb_t = time.monotonic()
        # HDBSCAN requires all-valid input. Subset to cards with
        # embeddings, cluster those, then leave the rest as
        # singletons (handled by the lexical fallback below).
        emb_indices = np.where(has_emb)[0]
        if len(emb_indices) >= 2:
            hdb = hdbscan.HDBSCAN(
                min_cluster_size=min_cluster,
                min_samples=min_samples,
                metric="cosine",
                algorithm="generic",  # generic supports any metric
                cluster_selection_method="leaf",
                core_dist_n_jobs=-1,
            )
            emb_subset = emb_norm[emb_indices].astype(np.float64)
            hdb_labels = hdb.fit_predict(emb_subset)
            logger.info(
                "HDBSCAN produced %d clusters in %.1fs (noise=-1: %d)",
                len(set(hdb_labels)) - (1 if -1 in hdb_labels else 0),
                time.monotonic() - hdb_t,
                int((hdb_labels == -1).sum()),
            )
        else:
            # Not enough embeddings — everything becomes singleton
            hdb_labels = np.full(len(emb_indices), -1, dtype=int)

        # Map HDBSCAN output (label per card-in-embeddings)
        # back to the global index. label == -1 → noise/singleton
        global_labels = np.full(n_total, -1, dtype=int)
        # Re-map the labels so they're compact (0, 1, 2, …)
        # for cleaner cluster_id hashing.
        hdb_to_compact: Dict[int, int] = {}
        for local_i, label in enumerate(hdb_labels):
            if label == -1:
                continue
            if label not in hdb_to_compact:
                hdb_to_compact[label] = len(hdb_to_compact)
            global_labels[emb_indices[local_i]] = hdb_to_compact[label]

        # Step 6: split any oversized HDBSCAN cluster.
        # HDBSCAN's natural density might still produce a 100-
        # card cluster if the corpus is dominated by similar
        # articles. Split it into per-event subclusters by
        # re-running single-linkage cosine on the cluster's
        # members only, capped at max_cluster.
        def split_oversized(idx_list: List[int]) -> List[List[int]]:
            """If |idx_list| > max_cluster, split via single-linkage
            cosine. Else return as-is."""
            if len(idx_list) <= max_cluster:
                return [idx_list]
            # Compute pairwise cosine within the cluster
            sub_emb = emb_norm[idx_list]
            sub_cos = sub_emb @ sub_emb.T
            np.fill_diagonal(sub_cos, 0.0)
            mask = np.triu(np.ones_like(sub_cos, dtype=bool), k=1)
            flat_cos = sub_cos[mask]
            flat_idx = np.argwhere(mask)
            order = np.argsort(-flat_cos)
            parent = list(range(len(idx_list)))
            def find(x: int) -> int:
                while parent[x] != x:
                    parent[x] = parent[parent[x]]
                    x = parent[x]
                return x
            def union(a: int, b: int) -> None:
                ra, rb = find(a), find(b)
                if ra != rb:
                    parent[rb] = ra
            for k in order:
                i, j = flat_idx[k]
                if flat_cos[k] < 0.65:  # cosine ≥ 0.65 = "same event"
                    break
                ri, rj = find(i), find(j)
                if ri == rj:
                    continue
                # Cap: stop merging if either side has hit the cap
                size_i = sum(1 for x in range(len(idx_list)) if find(x) == ri)
                size_j = sum(1 for x in range(len(idx_list)) if find(x) == rj)
                if size_i >= max_cluster or size_j >= max_cluster:
                    continue
                union(i, j)
            # Collect subclusters
            sub: Dict[int, List[int]] = {}
            for x in range(len(idx_list)):
                r = find(x)
                sub.setdefault(r, []).append(idx_list[x])
            return list(sub.values())

        # Apply the split
        cluster_to_members: Dict[int, List[int]] = {}
        next_label = 0
        for label in sorted(set(global_labels)):
            if label == -1:
                continue
            members = [i for i in range(n_total) if global_labels[i] == label]
            for sub in split_oversized(members):
                cluster_to_members[next_label] = sub
                next_label += 1

        # Singletons: cards that were noise (label=-1)
        for i in range(n_total):
            if global_labels[i] == -1:
                cluster_to_members[next_label] = [i]
                next_label += 1

        # Step 7: lexical fallback for cards WITHOUT embeddings.
        # These are typically cards that the embed step skipped
        # (very short summaries, errors). Try to merge them
        # into a semantic cluster by title Jaccard.
        if lexical_threshold > 0:
            cluster_token_centroid: Dict[int, Set[str]] = {}
            for label, members in cluster_to_members.items():
                if len(members) < 2:
                    continue
                toks: Set[str] = set()
                for i in members:
                    if has_emb[i]:
                        toks |= tokenize(rows[i]["title"])
                if toks:
                    cluster_token_centroid[label] = toks

            # For each embedding-less card, find the best cluster
            for i in range(n_total):
                if has_emb[i]:
                    continue
                toks_i = tokenize(rows[i]["title"])
                if not toks_i:
                    continue
                best_label = -1
                best_score = 0.0
                for label, toks_c in cluster_token_centroid.items():
                    if not toks_c:
                        continue
                    inter = len(toks_i & toks_c)
                    union_size = len(toks_i | toks_c)
                    if union_size == 0:
                        continue
                    score = inter / union_size
                    if score > best_score:
                        best_score = score
                        best_label = label
                if best_label >= 0 and best_score >= lexical_threshold:
                    # Move card from its singleton cluster into
                    # best_label's cluster
                    singleton_label = next(
                        lbl for lbl, mems in cluster_to_members.items()
                        if mems == [i]
                    )
                    cluster_to_members[best_label].append(i)
                    del cluster_to_members[singleton_label]

        # Step 8: produce cluster_id mapping (id → new_cluster_id)
        new_cluster_ids: List[str] = [""] * n_total
        for label, members in cluster_to_members.items():
            if len(members) >= 2:
                members_sorted = sorted(members)
                members_csv = ",".join(ids[i] for i in members_sorted)
                cid = hashlib.md5(members_csv.encode()).hexdigest()[:12]
            else:
                i = members[0]
                if has_emb[i]:
                    cid = hashlib.md5(f"emb-{ids[i]}".encode()).hexdigest()[:12]
                else:
                    sig = compute_title_signature(rows[i]["title"])
                    cid = (
                        hashlib.md5(sig.encode()).hexdigest()[:12]
                        if sig
                        else _lexical_cluster_id(ids[i])
                    )
            for i in members:
                new_cluster_ids[i] = cid

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
        "--min-cluster", type=int, default=DEFAULT_MIN_CLUSTER,
        help="HDBSCAN min_cluster_size (default 3). Smaller = more noise.",
    )
    parser.add_argument(
        "--min-samples", type=int, default=DEFAULT_MIN_SAMPLES,
        help="HDBSCAN min_samples (default 2). Higher = more noise.",
    )
    parser.add_argument(
        "--max-cluster", type=int, default=DEFAULT_MAX_CLUSTER,
        help="Soft cap on cluster size (default 50). Larger clusters are split.",
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
        min_cluster=args.min_cluster,
        min_samples=args.min_samples,
        max_cluster=args.max_cluster,
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
