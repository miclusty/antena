#!/usr/bin/env python3
"""Auto-synthesis trigger for AKIRA.

Run this after the Analyst skill creates new clusters.
It finds clusters without master articles and synthesizes them.
"""

import sqlite3
import sys
import os
import urllib.request
import json

AKIRA_DB = os.path.join(
    os.path.expanduser("~"),
    "proyectos",
    "news",
    "packages",
    "akira",
    "data",
    "akira.db",
)
SYNTHESIS_API = "http://localhost:5000/synthesis/batch"


def find_new_clusters():
    """Find clusters that have 2+ articles but no master article."""
    conn = sqlite3.connect(AKIRA_DB)
    rows = conn.execute("""
        SELECT nc.cluster_id, COUNT(*) as article_count
        FROM news_cards nc
        LEFT JOIN master_articles ma ON nc.cluster_id = ma.cluster_id
        WHERE nc.cluster_id IS NOT NULL 
          AND nc.cluster_id != ''
          AND ma.id IS NULL
        GROUP BY nc.cluster_id
        HAVING COUNT(*) >= 2
        ORDER BY COUNT(*) DESC
    """).fetchall()
    conn.close()
    return rows


def trigger_batch_synthesis(limit=100):
    """Trigger batch synthesis via AKIRA API."""
    try:
        req = urllib.request.Request(
            f"{SYNTHESIS_API}?limit={limit}",
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=300) as resp:
            result = json.loads(resp.read())
            return result
    except Exception as e:
        print(f"Error triggering synthesis: {e}")
        return None


def main():
    print("=== AKIRA Auto-Synthesis Trigger ===")

    new_clusters = find_new_clusters()
    print(f"Clusters needing synthesis: {len(new_clusters)}")

    if not new_clusters:
        print("No new clusters to synthesize.")
        return

    # Show top clusters
    print("\nTop clusters by article count:")
    for cluster_id, count in new_clusters[:10]:
        print(f"  {cluster_id}: {count} articles")

    # Trigger synthesis
    print(f"\nTriggering batch synthesis (limit={min(len(new_clusters), 100)})...")
    result = trigger_batch_synthesis(limit=min(len(new_clusters), 100))

    if result:
        print(f"\nResults:")
        print(f"  Total: {result.get('total', 0)}")
        print(f"  Success: {result.get('success', 0)}")
        print(f"  Failed: {result.get('failed', 0)}")
        print(f"  Skipped: {result.get('skipped', 0)}")
    else:
        print("Failed to trigger synthesis. Is AKIRA running on port 5000?")


if __name__ == "__main__":
    main()
