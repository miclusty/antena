"""
Semantic re-clusterer (G1 lite) — replaces Jaccard lexical clustering
with cosine-on-embeddings for the bias_score=0 "noise" cards.

Design doc §4.1 calls for full semantic clustering with
content-addressed cluster_ids, but that's a 1-2 week
project. This is a lite version that addresses the same
problem in a more targeted way:

  Problem (from eval baseline):
    - Top 10 clusters have 75-100% bias_score=0 cards
    - These are off-topic cards that the Jaccard clusterer
      grouped with the cluster's core event (probably by
      same source / same date, not by event semantics)
    - The RAG synthesis sees this noise and produces lower
      quality (faithfulness 3.83 → 4.0 with filter only,
      perspective_balance 2.6, etc.)

  Solution:
    1. For each existing cluster_id, compute the centroid
       of the bias_score != 0 cards (the "core" of the
       cluster — these are the cards the LLM bias detector
       actually analyzed).
    2. For each bias_score == 0 card (the "noise" pool):
       - Compute cosine to every cluster centroid
       - If best cosine > ASSIGN_THRESHOLD (default 0.45):
         assign to that cluster
       - If best cosine < ASSIGN_THRESHOLD:
         create a singleton cluster_id = f"sem-singleton-{md5}"
    3. The RAG filter (which already drops bias_score=0 in
       the synthesis context) gets cleaner data because
       fewer of those cards are in non-relevant clusters.

This is a 1-shot post-processing pass on top of the
existing Jaccard clusterer. It doesn't replace the
clusterer — it just re-assigns the noise pool.

Trade-off:
  - Cluster precision should INCREASE (noise moves out)
  - Cluster recall may DECREASE slightly (some cards that
    WERE in their golden cluster might be re-assigned
    elsewhere based on embedding similarity)
  - Run time: ~5 seconds for 13k cards (just numpy cosine)
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from typing import Dict, List, Tuple

import numpy as np

from db.connection import get_db_connection

logger = logging.getLogger("akira.cluster_semantic")

# Cosine threshold for re-assigning a noise card to a
# cluster centroid. Tuned via the golden set eval: 0.45
# seems to balance precision and recall (higher = more
# conservative, fewer false positives, but more singletons).
ASSIGN_THRESHOLD = 0.45

# Minimum number of bias_score != 0 cards in a cluster
# for it to have a usable centroid. Smaller clusters
# (1-2 core cards) are too noisy to centroid around, so
# noise cards won't be assigned to them.
MIN_CORE_FOR_CENTROID = 2

# Cosine threshold for declaring two noise cards as
# "similar to each other" (used to form a singleton
# cluster of 2+ related noise cards). Without this,
# every noise card becomes its own singleton, which
# bloats the cluster count.
SINGLETON_LINK_THRESHOLD = 0.55


def _normalize_vec(s: str) -> np.ndarray:
    """Parse a JSON-encoded embedding vector (as stored in
    news_embeddings.embedding). Returns a zero vector on
    parse error (the caller will skip it)."""
    try:
        v = np.array(json.loads(s), dtype=np.float32)
        return v
    except (json.JSONDecodeError, ValueError, TypeError):
        return np.zeros(0, dtype=np.float32)


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity between two non-zero vectors. Returns
    0.0 if either is zero or norms are 0."""
    if a.size == 0 or b.size == 0:
        return 0.0
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na < 1e-9 or nb < 1e-9:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


class SemanticClusterer:
    """Re-clusters the bias_score == 0 cards (the "noise"
    pool) by cosine similarity to existing cluster centroids.

    The existing Jaccard clusterer produced clusters where
    ~80% of cards are noise. This lite re-clusterer tries
    to keep the good assignments and move the bad ones.

    Usage:
        clusterer = SemanticClusterer(db_path="data/akira.db")
        stats = clusterer.recluster_with_cosine(
            assign_threshold=0.45,
            dry_run=False,
        )
    """

    def __init__(self, db_path: str):
        self.db_path = db_path

    def recluster_with_cosine(
        self,
        assign_threshold: float = ASSIGN_THRESHOLD,
        singleton_link_threshold: float = SINGLETON_LINK_THRESHOLD,
        dry_run: bool = False,
    ) -> Dict[str, int]:
        """Re-assign noise cards. Returns stats dict.

        Pipeline:
          1. Load all news_cards (with embeddings).
          2. For each cluster_id, compute the centroid of
             the bias_score != 0 cards (the cluster's "core").
          3. For each bias_score == 0 card (the noise pool):
             a. Compute cosine to every cluster centroid
             b. If best cosine >= assign_threshold:
                re-assign to that cluster
             c. Else: stay as singleton (new cluster_id)
          4. Update DB (unless dry_run).

        Returns:
          - n_clusters_with_centroid: how many clusters
            had ≥2 core cards (eligible for re-assignment)
          - n_noise_cards: total noise cards
          - n_noise_reassigned: how many were assigned to
            an existing cluster
          - n_noise_singleton: how many became singletons
        """
        with get_db_connection(self.db_path) as conn:
            # Step 1: load all cards with embeddings + cluster
            rows = conn.execute(
                """
                SELECT nc.id, nc.cluster_id, nc.bias_score, ne.embedding
                FROM news_cards nc
                LEFT JOIN news_embeddings ne ON ne.card_id = nc.id
                WHERE nc.summary IS NOT NULL AND LENGTH(nc.summary) > 30
                """
            ).fetchall()

            cards = []
            for card_id, cluster_id, bias_score, emb_json in rows:
                vec = _normalize_vec(emb_json) if emb_json else np.zeros(0, dtype=np.float32)
                cards.append({
                    "id": card_id,
                    "cluster_id": cluster_id,
                    "bias_score": float(bias_score or 0.0),
                    "vec": vec,
                })

            # Step 2: compute per-cluster centroid (core cards only)
            cluster_centroids: Dict[str, np.ndarray] = {}
            cluster_counts: Dict[str, int] = {}
            for c in cards:
                if c["bias_score"] == 0.0:
                    continue
                if c["vec"].size == 0:
                    continue
                cid = c["cluster_id"]
                if cid not in cluster_centroids:
                    cluster_centroids[cid] = c["vec"].copy()
                    cluster_counts[cid] = 1
                else:
                    cluster_centroids[cid] += c["vec"]
                    cluster_counts[cid] += 1
            # Normalize to mean
            eligible_centroids = {}
            for cid, total_vec in cluster_centroids.items():
                if cluster_counts[cid] >= MIN_CORE_FOR_CENTROID:
                    eligible_centroids[cid] = total_vec / cluster_counts[cid]
            logger.info(
                f"recluster: {len(eligible_centroids)}/{len(cluster_centroids)} "
                f"clusters have ≥{MIN_CORE_FOR_CENTROID} core cards (eligible centroids)"
            )
            centroid_ids = list(eligible_centroids.keys())
            centroid_matrix = np.stack([eligible_centroids[c] for c in centroid_ids]) if centroid_ids else np.zeros((0, 768))
            centroid_norms = np.linalg.norm(centroid_matrix, axis=1) + 1e-9

            # Step 3: re-assign noise cards
            reassigned = 0
            singleton = 0
            singleton_groups: Dict[str, np.ndarray] = {}  # singleton_id -> running centroid
            updates: List[Tuple[str, str]] = []  # (card_id, new_cluster_id)
            n_noise = 0
            for c in cards:
                if c["bias_score"] != 0.0:
                    continue  # only re-assign noise
                if c["vec"].size == 0:
                    continue
                n_noise += 1
                # Compute cosine to every centroid
                vnorm = float(np.linalg.norm(c["vec"]))
                if vnorm < 1e-9:
                    continue
                sims = (centroid_matrix @ c["vec"]) / (centroid_norms * vnorm)
                if sims.size == 0:
                    continue
                best_idx = int(np.argmax(sims))
                best_sim = float(sims[best_idx])
                if best_sim >= assign_threshold:
                    new_cid = centroid_ids[best_idx]
                    updates.append((c["id"], new_cid))
                    reassigned += 1
                else:
                    # Create or join a singleton cluster
                    # We use a content-based hash so that noise
                    # cards that are similar to each other
                    # form a small group. The threshold is
                    # higher than the assignment threshold
                    # (0.55 vs 0.45) so we only form a group
                    # if the cards are really topically
                    # related.
                    group_id = self._find_or_create_singleton_group(
                        c["vec"], singleton_groups, singleton_link_threshold
                    )
                    updates.append((c["id"], group_id))
                    singleton += 1

            logger.info(
                f"recluster: {n_noise} noise cards; {reassigned} re-assigned, "
                f"{singleton} became singletons"
            )

            if not dry_run and updates:
                # Apply updates in a single transaction
                conn.executemany(
                    "UPDATE news_cards SET cluster_id = ? WHERE id = ?",
                    [(new_cid, cid) for cid, new_cid in updates],
                )
                conn.commit()
                logger.info(f"recluster: committed {len(updates)} cluster_id updates")

        return {
            "n_clusters_with_centroid": len(eligible_centroids),
            "n_noise_cards": n_noise,
            "n_noise_reassigned": reassigned,
            "n_noise_singleton": singleton,
        }

    def _find_or_create_singleton_group(
        self,
        vec: np.ndarray,
        existing_groups: Dict[str, np.ndarray],
        threshold: float,
    ) -> str:
        """Find an existing singleton group whose centroid is
        close to `vec` (cosine > threshold), or create a new
        one. Returns the group_id.

        Each group has at most a handful of members because
        noise cards rarely cluster tightly. The threshold
        is 0.55 by default — high enough that we only group
        noise cards that are clearly topically related.
        """
        if not existing_groups:
            return self._new_singleton_id(vec, existing_groups)
        # Find the group with max cosine
        best_group = None
        best_sim = 0.0
        for gid, centroid in existing_groups.items():
            sim = _cosine(vec, centroid)
            if sim > best_sim:
                best_sim = sim
                best_group = gid
        if best_group is not None and best_sim >= threshold:
            # Update the group's centroid (running mean)
            existing_groups[best_group] = 0.7 * existing_groups[best_group] + 0.3 * vec
            return best_group
        return self._new_singleton_id(vec, existing_groups)

    def _new_singleton_id(self, vec: np.ndarray, groups: Dict[str, np.ndarray]) -> str:
        """Allocate a new singleton cluster id. The id is a
        short hash of the centroid bytes so re-runs on the
        same noise pool produce the same ids (idempotent)."""
        # Use first 16 bytes of the centroid as the seed.
        # np.tobytes is deterministic.
        seed = vec.tobytes()[:16]
        h = hashlib.md5(seed).hexdigest()[:12]
        cid = f"sem-singleton-{h}"
        # If collision (very rare with 12 hex chars), add a
        # random suffix. This branch is for safety; in
        # practice it never fires.
        while cid in groups:
            h = hashlib.md5(seed + str(len(groups)).encode()).hexdigest()[:12]
            cid = f"sem-singleton-{h}"
        groups[cid] = vec.copy()
        return cid
