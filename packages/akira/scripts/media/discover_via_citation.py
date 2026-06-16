#!/usr/bin/env python3
"""
Discover new media sources by mining article citations.

For each news card with a body, scan for mentions of:

  - Other newspapers ("según El Diario de X", "el portal Y")
  - Radio stations ("Radio Z FM")
  - News agencies ("Télam", "NA", "Reuters")
  - TV channels ("Canal 9", "C5N")

When a citation is found, attempt to resolve it to a real source:

  1. If the citation matches a known media in argentine_media,
     increment its mention count (signal for relevance).
  2. If it's a new source, save it as a candidate and queue
     it for downstream website discovery.

Approach: we DON'T use the LLM here — this is a deterministic
regex pass over existing content. The LLM is reserved for the
synthesis side. Citation discovery is essentially string
matching against a curated list of Spanish media prefixes.

CLI:
    --db PATH        AKIRA sqlite
    --limit N        Process at most N cards
    --min-mentions N Only keep a candidate with >= N mentions
    --dry-run        Show what would be discovered, don't write
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import unicodedata
from collections import Counter, defaultdict
from typing import Dict, List, Set, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import coverage


# ─── Patterns ───────────────────────────────────────────────
# These regex match common Spanish-language citations of news
# sources. We keep them narrow on purpose: false positives in
# this step create a flood of garbage candidates, so we err on
# the side of under-matching.

# Match "Diario X", "El X de Y", "Portal X", "Revista X"
NEWSPAPER_PATTERNS = [
    r"\b(?:Diario|El|Periódico|Portal|Semanario|Revista)\s+"
    r"(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,3})",
]

# Match "Radio X FM", "Radio X AM", "FM X", "AM X", "Cadena X"
RADIO_PATTERNS = [
    r"\b(?:Radio|FM|AM|Cadena|Emisora)\s+"
    r"(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ0-9]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ0-9]+){0,3})"
    r"(?:\s+(?:FM|AM))?",
    r"\b(?:FM|AM)\s+(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ0-9]+)",
]

# Match "Canal X", "TN", "C5N", "Crónica TV"
TV_PATTERNS = [
    r"\bCanal\s+(?:[0-9]+|[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)",
    r"\b(?:C5N|TN|CNN\s+en\s+Español| América\s+24| A24| Crónica\s+TV)\b",
]

# Major news agencies we want to track explicitly
KNOWN_AGENCIES = {
    "Télam", "NA", "NA Noticias Argentinas", "Reuters", "AP",
    "EFE", "AFP", "ANSA", "Europa Press", "Bloomberg",
    "France 24", "DW", "BBC Mundo",
}

# Stopwords to drop false positives
NAME_STOPWORDS = {
    "Diario", "El", "La", "Los", "Las", "De", "Del", "Al",
    "Hoy", "Mañana", "Ayer", "Tarde", "Noche", "Día",
    "Mayor", "Menor", "Nueva", "Nuevo", "Antiguo",
    "Color", "Sol", "Lluvia", "Frío", "Calor",
    "Fútbol", "Fútbol", "Deporte", "Deportes",
    "Tiempo", "Tiempos", "Mundo", "País", "Ciudad",
    "Federal", "Nacional", "Provincial", "Local", "Regional",
    "Editor", "Editora", "Staff", "Redacción", "Notas",
}


def normalize(s: str) -> str:
    return (
        s.lower().strip()
        .replace("á", "a").replace("é", "e").replace("í", "i")
        .replace("ó", "o").replace("ú", "u").replace("ñ", "n")
    )


def extract_citations(text: str) -> List[Tuple[str, str]]:
    """Scan article text and return list of (citation, type) tuples.

    Type is one of: "diario", "radio", "tv", "agency".
    """
    found: List[Tuple[str, str]] = []

    for pat in NEWSPAPER_PATTERNS:
        for m in re.finditer(pat, text):
            name = m.group(0).strip()
            if _is_valid_citation(name):
                found.append((name, "diario"))

    for pat in RADIO_PATTERNS:
        for m in re.finditer(pat, text):
            name = m.group(0).strip()
            if _is_valid_citation(name):
                found.append((name, "radio"))

    for pat in TV_PATTERNS:
        for m in re.finditer(pat, text):
            name = m.group(0).strip()
            if _is_valid_citation(name):
                found.append((name, "tv"))

    for agency in KNOWN_AGENCIES:
        if re.search(rf"\b{re.escape(agency)}\b", text):
            found.append((agency, "agency"))

    return found


def _is_valid_citation(name: str) -> bool:
    """Filter out false positives: too short, all stopwords, etc."""
    if len(name) < 4 or len(name) > 60:
        return False
    words = name.split()
    # Must start with a non-stopword capitalized word
    if not words:
        return False
    if words[0] in NAME_STOPWORDS:
        return False
    # Must have at least one non-stopword word
    real_words = [w for w in words if w not in NAME_STOPWORDS]
    if len(real_words) < 1:
        return False
    return True


def is_known_media(name: str, known: Dict[str, int]) -> bool:
    """Check if the citation matches a known media entry (fuzzy)."""
    nn = normalize(name)
    # Direct match
    if nn in known:
        return True
    # Substring match — known contains citation or vice versa
    for k in known:
        if nn in k or k in nn:
            return True
    return False


def main() -> int:
    p = argparse.ArgumentParser(
        description="Discover new media sources via citation mining"
    )
    p.add_argument("--db", default=coverage.DEFAULT_DB)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--min-mentions", type=int, default=2,
                    help="Only keep candidates with >= N mentions")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args()

    conn = coverage.get_connection(args.db)

    # Build the known media lookup
    known: Dict[str, int] = {}
    for row in conn.execute(
        "SELECT id, name, type, city FROM argentine_media"
    ).fetchall():
        nn = normalize(row[1])
        known[nn] = row[0]
    print(f"Known media: {len(known)} entries")

    # Pull article bodies
    # news_cards has source_ids as a JSON array (1 or 2 ids).
    # We pick the first one for the source_name label.
    sql = """
        SELECT nc.id, nc.title, nc.body, nc.article_url,
               nc.source_ids, nc.location_id, nc.published_at
        FROM news_cards nc
        WHERE nc.body IS NOT NULL AND nc.body != ''
    """
    cards = conn.execute(sql).fetchall()
    if args.limit > 0:
        cards = cards[: args.limit]
    print(f"Processing {len(cards)} cards with body...")

    # Mine citations
    mention_counts: Counter = Counter()
    mention_samples: Dict[Tuple[str, str], List[Dict]] = defaultdict(list)

    for cid, title, body, url, source_ids_json, loc_id, published_at in cards:
        # Resolve the first source_id to a name (best-effort)
        src_name = None
        try:
            ids = json.loads(source_ids_json or "[]")
            if ids:
                row = conn.execute(
                    "SELECT name FROM sources WHERE id=?",
                    (ids[0],),
                ).fetchone()
                if row:
                    src_name = row[0]
        except Exception:
            pass

        text = f"{title or ''}\n{body or ''}"
        for name, ctype in extract_citations(text):
            key = (normalize(name), ctype)
            mention_counts[key] += 1
            if len(mention_samples[key]) < 3:
                mention_samples[key].append({
                    "card_id": cid,
                    "source": src_name,
                    "url": url,
                })

    print(f"Distinct citation candidates: {len(mention_counts)}")

    # Categorize: known vs candidate
    known_mentions = []
    new_candidates = []

    for (nn, ctype), count in mention_counts.most_common():
        if is_known_media(nn, known):
            known_mentions.append((nn, ctype, count))
        elif count >= args.min_mentions:
            new_candidates.append((nn, ctype, count, mention_samples[(nn, ctype)]))

    print(f"Known media (matched): {len(known_mentions)}")
    print(f"New candidates (>= {args.min_mentions} mentions): {len(new_candidates)}")

    if args.verbose:
        print("\nTop known mentions:")
        for nn, ctype, count in known_mentions[:15]:
            print(f"  [{ctype}] {nn}: {count} mentions")
        print("\nTop new candidates:")
        for nn, ctype, count, _ in new_candidates[:25]:
            print(f"  [{ctype}] {nn}: {count} mentions")

    if args.dry_run:
        print("\n--dry-run: would not write")
        return 0

    # Save new candidates to argentine_media as 'web' type
    # (we don't know if it's a radio, diario, or tv yet — that
    # will be resolved by the next discovery script that fetches
    # the candidate's website)
    inserted = 0
    for nn, ctype, count, samples in new_candidates:
        # Reconstruct a readable name
        display_name = samples[0].get("source") or nn.title()
        # Try to get a town from the card's location_id (we'd need
        # to join to locations; for now we save with NULL and
        # let the reconciliation job later attach the right town)
        try:
            ok = coverage.import_radio(
                conn,
                name=display_name,
                type=ctype if ctype in ("diario", "radio", "tv", "web") else "web",
                city=nn.title(),
                province=None,
                codgl=None,
                website=None,  # to be discovered later
                stream_url=None,
                tags=f"discovered-via-citation:count={count}",
                source="citation-mining",
            )
            if ok:
                inserted += 1
        except Exception as e:
            print(f"  err inserting {nn}: {e}")

    conn.commit()
    print(f"\nInserted {inserted} new candidate media entries")

    s = coverage.stats(conn)
    print(f"Total media: {sum(s['by_type'].values())}")
    print(f"By type: {s['by_type']}")
    print(f"By source: {s['by_source']}")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
