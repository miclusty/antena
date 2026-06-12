"""News clustering service - groups news cards by title similarity.

Uses normalized text fingerprinting and edit-distance for lightweight clustering.
No external ML dependencies required.
"""

import re
import hashlib
import logging
from typing import List, Dict, Set, Optional
from collections import defaultdict

from core.db_helpers import get_db_connection

logger = logging.getLogger("akira")

# Min word overlap ratio to consider two items part of the same cluster
OVERLAP_THRESHOLD = 0.5
# Minimum cluster size
MIN_CLUSTER_SIZE = 2


def normalize_text(text: str) -> str:
    """Normalize text for comparison: lowercase, remove accents, punctuation, extra spaces."""
    if not text:
        return ""
    text = text.lower()
    # Remove accents
    text = (
        text.replace("á", "a")
        .replace("é", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ú", "u")
    )
    text = text.replace("ü", "u").replace("ñ", "n")
    text = re.sub(r"[^\w\s]", "", text)  # Remove punctuation
    text = re.sub(r"\s+", " ", text).strip()  # Normalize whitespace
    return text


def get_title_words(title: str, min_len: int = 3) -> Set[str]:
    """Get significant words from a title."""
    words = normalize_text(title).split()
    return {w for w in words if len(w) >= min_len}


def compute_title_signature(title: str) -> str:
    """Compute a signature hash from the most significant words in a title."""
    words = get_title_words(title)
    # Take top 6 words by length, sorted
    key_words = sorted(words, key=len, reverse=True)[:6]
    return "|".join(sorted(key_words))


def jaccard_similarity(set1: Set[str], set2: Set[str]) -> float:
    """Compute Jaccard similarity between two sets."""
    if not set1 or not set2:
        return 0.0
    intersection = len(set1 & set2)
    union = len(set1 | set2)
    return intersection / union if union > 0 else 0.0


class ClusteringService:
    """
    Groups news cards into clusters based on title word overlap.

    Algorithm:
    1. Normalize all titles
    2. Group by exact signature match first
    3. For remaining items, use Jaccard similarity to merge into existing clusters
    4. Items below threshold become singletons

    Clusters are stored by updating cluster_id in news_cards table.
    """

    def __init__(self, db_path: str, overlap_threshold: float = OVERLAP_THRESHOLD):
        self.db_path = db_path
        self.threshold = overlap_threshold

    def cluster_news_cards(self, card_ids: List[str]) -> Dict[str, List[str]]:
        """
        Cluster news cards by title similarity.

        Args:
            card_ids: List of news card IDs to cluster

        Returns:
            Dict mapping cluster_id -> list of card_ids
        """
        if not card_ids:
            return {}

        with get_db_connection(self.db_path) as conn:
            placeholders = ",".join("?" * len(card_ids))
            rows = conn.execute(
                f"SELECT id, title FROM news_cards WHERE id IN ({placeholders})",
                card_ids,
            ).fetchall()

            if not rows:
                return {}

            items = [(str(row["id"]), row["title"] or "") for row in rows]
            clusters = self._compute_clusters(items)

            # Update DB with cluster IDs
            for cluster_id, ids in clusters.items():
                for card_id in ids:
                    conn.execute(
                        "UPDATE news_cards SET cluster_id = ? WHERE id = ?",
                        (cluster_id, card_id),
                    )
            conn.commit()

        logger.info(
            f"clustering_complete cards={len(card_ids)} clusters={len(clusters)}"
        )
        return clusters

    def _compute_clusters(self, items: List[tuple]) -> Dict[str, List[str]]:
        """
        Compute clusters using word overlap.

        Strategy:
        1. Group by exact signature match (high confidence)
        2. For signatures with 2+ items, merge into cluster
        3. For singletons, try to merge into existing clusters via Jaccard
        """
        id_to_words = {id_: get_title_words(title) for id_, title in items}
        id_to_sig = {id_: compute_title_signature(title) for id_, title in items}

        # Phase 1: Group by exact signature
        sig_to_ids: Dict[str, List[str]] = defaultdict(list)
        for id_, sig in id_to_sig.items():
            sig_to_ids[sig].append(id_)

        # Build initial clusters from signature groups
        cluster_id_map: Dict[str, str] = {}  # card_id -> cluster_id
        pending_singles: List[str] = []

        for sig, ids in sig_to_ids.items():
            if len(ids) >= MIN_CLUSTER_SIZE:
                cluster_id = hashlib.md5(sig.encode()).hexdigest()[:12]
                for id_ in ids:
                    cluster_id_map[id_] = cluster_id
            else:
                pending_singles.extend(ids)

        # Phase 2: Try to merge singletons into existing clusters
        clusters: Dict[str, List[str]] = defaultdict(list)
        for id_, cid in cluster_id_map.items():
            clusters[cid].append(id_)

        for single_id in pending_singles:
            single_words = id_to_words.get(single_id, set())
            if not single_words:
                # No words to compare, give it its own cluster
                cluster_id = hashlib.md5(single_id.encode()).hexdigest()[:8]
                clusters[cluster_id] = [single_id]
                continue

            best_cluster = None
            best_score = 0.0

            for cid, members in clusters.items():
                # Check similarity against cluster representative (first member)
                rep_id = members[0]
                rep_words = id_to_words.get(rep_id, set())
                score = jaccard_similarity(single_words, rep_words)

                # Also check average similarity to all cluster members (sample first 3)
                scores = [score]
                for mid in members[1:4]:
                    m_words = id_to_words.get(mid, set())
                    scores.append(jaccard_similarity(single_words, m_words))
                avg_score = sum(scores) / len(scores)

                if avg_score > best_score:
                    best_score = avg_score
                    best_cluster = cid

            if best_cluster and best_score >= self.threshold:
                clusters[best_cluster].append(single_id)
                cluster_id_map[single_id] = best_cluster
            else:
                # No good match, create singleton cluster
                cluster_id = hashlib.md5(single_id.encode()).hexdigest()[:8]
                clusters[cluster_id] = [single_id]

        # Clean up empty clusters
        return {k: v for k, v in clusters.items() if v}

    def cluster_recent_news(
        self, hours: int = 24, limit: int = 500
    ) -> Dict[str, List[str]]:
        """
        Cluster recent unclustered news cards from the database.

        Args:
            hours: Only consider news from the last N hours
            limit: Maximum number of cards to process

        Returns:
            Dict mapping cluster_id -> list of card_ids
        """
        with get_db_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT id FROM news_cards
                WHERE (cluster_id IS NULL OR cluster_id = '')
                AND created_at >= datetime('now', '-' || ? || ' hours')
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (hours, limit),
            ).fetchall()

            card_ids = [str(row["id"]) for row in rows]

        if not card_ids:
            return {}

        return self.cluster_news_cards(card_ids)
