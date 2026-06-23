#!/usr/bin/env python3
# DEPRECATED 2026-06-20: Keyword-based bias classifier.
# Replaced by core.llm_client via synthesis.py / pipeline LLM calls.
# Do NOT run this script unless you know what you're doing. See git history
# for the implementation if you need to revive it.
#
# Original docstring preserved below for reference.
#
"""
backfill_bias.py - Retroactively compute bias_score for news_cards with bias_score=0.0 or NULL.

Uses keyword heuristics for Argentine politics:
  Pro-gobierno: "gobierno", "presidente", "ministerio", "política pública", "iniciativa"
  Anti-gobierno: "oposición", "crítica", "escándalo", "corrupción", "fracaso"
  Neutral: balanced reporting (no strong keywords detected)

Scale: -1.0 (anti-gobierno) to +1.0 (pro-gobierno), 0.0 neutral
"""
import sqlite3
import re
import sys
import os
from collections import Counter

AKIRA_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "akira.db")

# Keyword sets for Argentine political bias (case-insensitive)
PRO_GOBIERNO = {
    "gobierno", "presidente", "ministerio", "política pública", "iniciativa",
    "estado", "nacional", "provincial", "executive", "gestión", "administración",
    "reforma", "plan", "programa", "inversión", "desarrollo", "crecimiento",
    "empleo", "producción", "trabajo", "salud", "educación", "infraestructura"
}

ANTI_GOBIERNO = {
    "oposición", "crítica", "escándalo", "corrupción", "fracaso",
    "denuncia", "investigar", "juicio", "procesar", "imputar", "detención",
    "prisión", "escándalo", "miedo", "temor", "inseguridad", "crisis",
    "reclamo", "protesta", "movimiento", "marcha", "piquetera", "conflicto",
    "deuda", "inflación", "pobreza", "desempleo", "ajuste", "recorte"
}

# Partial/weak signals
MIXED_SIGNALS = {
    "debate", "polémica", "discusíon", "desacuerdo", "negociación", "congreso",
    "legislatura", "cámpora", "senado", "diputado", "votación", "proyecto"
}


def compute_keyword_bias(title: str, summary: str) -> float:
    """Compute bias score from keyword matching in title+summary."""
    if not title and not summary:
        return 0.0

    text = f"{title} {summary or ''}".lower()

    # Extract words (split on non-alphanumeric)
    words = re.findall(r'\b\w+\b', text)

    pro_count = sum(1 for w in words if w in PRO_GOBIERNO)
    anti_count = sum(1 for w in words if w in ANTI_GOBIERNO)
    mixed_count = sum(1 for w in words if w in MIXED_SIGNALS)

    net = pro_count - anti_count

    if net > 0:
        # Normalize to +0.1 to +0.9 range based on keyword count
        score = min(0.9, 0.1 + (net * 0.15))
        return round(score, 2)
    elif net < 0:
        score = max(-0.9, -0.1 + (net * 0.15))
        return round(score, 2)
    else:
        # No strong keywords — check mixed signals
        if mixed_count >= 3:
            return 0.0  # Controversial but balanced
        return 0.0


def get_text(item_id: str, conn: sqlite3.Connection) -> tuple:
    """Get title and summary for a card."""
    row = conn.execute(
        "SELECT title, summary FROM news_cards WHERE id = ?",
        (item_id,)
    ).fetchone()
    return (row["title"] or "", row["summary"] or "") if row else ("", "")


def main():
    print(f"AKIRA Bias Backfill")
    print(f"Database: {AKIRA_DB}")

    conn = sqlite3.connect(AKIRA_DB)
    conn.row_factory = sqlite3.Row

    # Count before
    before = conn.execute("""
        SELECT bias_score, COUNT(*) as cnt
        FROM news_cards
        GROUP BY bias_score
        ORDER BY cnt DESC
        LIMIT 10
    """).fetchall()
    print("\n--- BEFORE ---")
    for row in before:
        print(f"  bias_score={row['bias_score']}  count={row['cnt']}")

    # Get cards with bias_score = 0.0 or NULL (these are the unanalyzed ones)
    # Note: after harvest_run fix, new inserts use NULL, but existing 7117 have 0.0
    cards = conn.execute("""
        SELECT id, title, summary FROM news_cards
        WHERE bias_score IS NULL OR bias_score = 0.0
    """).fetchall()
    print(f"\nCards to backfill: {len(cards)}")

    updated = 0
    skipped = 0

    for card in cards:
        title, summary = card["title"] or "", card["summary"] or ""
        if not title:
            skipped += 1
            continue

        bias = compute_keyword_bias(title, summary)
        conn.execute(
            "UPDATE news_cards SET bias_score = ? WHERE id = ?",
            (bias, card["id"])
        )
        updated += 1

    conn.commit()
    print(f"Updated: {updated}, Skipped (no title): {skipped}")

    # Count after
    after = conn.execute("""
        SELECT bias_score, COUNT(*) as cnt
        FROM news_cards
        GROUP BY bias_score
        ORDER BY cnt DESC
        LIMIT 10
    """).fetchall()
    print("\n--- AFTER ---")
    for row in after:
        print(f"  bias_score={row['bias_score']}  count={row['cnt']}")

    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
