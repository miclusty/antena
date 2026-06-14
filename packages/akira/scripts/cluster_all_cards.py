#!/usr/bin/env python3
"""Cluster all unclustered news cards in the database.

This script processes ALL unclustered cards regardless of age,
allowing the background auto-clustering to handle new cards going forward.
"""

import sys
import os

# Add package root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.clustering import ClusteringService
from core.db_helpers import get_db_connection


def cluster_all_unclustered(db_path: str, batch_size: int = 500):
    """Cluster all unclustered news cards.

    Args:
        db_path: Path to the SQLite database
        batch_size: Number of cards to process per batch

    Returns:
        Total number of cards clustered
    """
    cs = ClusteringService(db_path)
    total_clustered = 0
    batch_num = 0

    while True:
        with get_db_connection(db_path) as conn:
            rows = conn.execute(
                "SELECT id FROM news_cards WHERE cluster_id IS NULL LIMIT ?",
                (batch_size,)
            ).fetchall()

            if not rows:
                print("No more unclustered cards.")
                break

            card_ids = [str(row["id"]) for row in rows]
            batch_num += 1

            print(f"Batch {batch_num}: Processing {len(card_ids)} cards...")
            clusters = cs.cluster_news_cards(card_ids)
            cards_in_batch = sum(len(v) for v in clusters.values())
            total_clustered += cards_in_batch

            print(f"  -> Created {len(clusters)} clusters covering {cards_in_batch} cards")

            # If we got fewer cards than batch_size, we're done
            if len(card_ids) < batch_size:
                break

    return total_clustered


def recluster_everything(db_path: str, batch_size: int = 1000):
    """Wipe all cluster_id and re-cluster from scratch.

    Useful after upgrading the clustering algorithm (e.g. v1 → v2)
    so the new heuristics can re-balance the assignments.
    """
    cs = ClusteringService(db_path)
    print("Wiping all cluster_id assignments...")
    with get_db_connection(db_path) as conn:
        conn.execute("UPDATE news_cards SET cluster_id = NULL")
        conn.commit()
    print("Re-clustering from scratch...")
    return cluster_all_unclustered(db_path, batch_size=batch_size)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Cluster news cards")
    parser.add_argument(
        "--db-path",
        default="data/akira.db",
        help="Path to akira.db (default: data/akira.db)"
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="Cards per batch (default: 500)"
    )
    parser.add_argument(
        "--recluster",
        action="store_true",
        help="Wipe all cluster_id and re-cluster from scratch (use after"
             " upgrading the clustering algorithm or adjusting the"
             " threshold).",
    )
    args = parser.parse_args()

    # Resolve relative path
    if not os.path.isabs(args.db_path):
        script_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        db_path = os.path.join(script_dir, args.db_path)
    else:
        db_path = args.db_path

    print(f"Database: {db_path}")
    print(f"Batch size: {args.batch_size}")
    print(f"Recluster from scratch: {args.recluster}")
    print("-" * 50)

    if args.recluster:
        total = recluster_everything(db_path, batch_size=args.batch_size)
    else:
        # Report current state
        with get_db_connection(db_path) as conn:
            total_count = conn.execute("SELECT COUNT(*) FROM news_cards").fetchone()[0]
            unclustered = conn.execute(
                "SELECT COUNT(*) FROM news_cards WHERE cluster_id IS NULL"
            ).fetchone()[0]
            print(f"Total cards: {total_count}")
            print(f"Unclustered cards: {unclustered} ({100*unclustered/total_count:.1f}%)")
            print("-" * 50)

        if unclustered == 0:
            print("Nothing to do!")
            return

        total = cluster_all_unclustered(db_path, batch_size=args.batch_size)

    print("-" * 50)
    print(f"Total cards clustered: {total}")

    # Final report
    with get_db_connection(db_path) as conn:
        remaining = conn.execute(
            "SELECT COUNT(*) FROM news_cards WHERE cluster_id IS NULL"
        ).fetchone()[0]
        clustered = conn.execute(
            "SELECT COUNT(DISTINCT cluster_id) FROM news_cards WHERE cluster_id IS NOT NULL"
        ).fetchone()[0]
        print(f"Remaining unclustered: {remaining}")
        print(f"Total clusters: {clustered}")


if __name__ == "__main__":
    main()
