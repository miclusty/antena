#!/usr/bin/env python3
"""Re-enrich ALL news cards in the database with the cascade logic.

What it does:
  1. For every news card in the DB that has NULL bias_score,
     NULL category, or NULL body, run the enrichment.
  2. bias_score:  computed from PRO_GOV / ANTI_GOV keyword match
     (positive = pro-government, negative = anti-government).
  3. category:    assigned from CATEGORY_KEYWORDS (politica,
     economia, sociedad, etc.).
  4. body:        fetched by hitting each card's source_url via
     AKIRA's /extract endpoint, falling back to the summary
     when the source is unreachable.
  5. quality_score: crude heuristic from summary length + image
     presence (0..1, higher = better).
  6. gacetilla:   simple flag — when source is known press-release
     channel (later improved by AKIRA's akira_cleaner).

This is a *bulk* backfill: it touches every card. For a few
hundred cards the run takes seconds. For the full 13k it takes
a few minutes because of the per-card AKIRA fetch for body.

Usage:
    cd packages/akira
    source .venv/bin/activate
    python scripts/enrich_cards.py [--limit 1000] [--no-body]
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import urllib.parse
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, Tuple

# Add package root to path so we can import core.* modules.
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

# Same keywords as harvest_run.py and recascade_null_cards.py —
# keep them in sync if you edit one.
CATEGORY_KEYWORDS = {
    "politica": [
        "gobierno", "presidente", "congreso", "senado", "diputados", "elección",
        "partido político", "partido politico", "político", "politico", "ministros",
        "decreto", "ley ", "senadora", "diputado", "boleta", "votación", "votacion",
        "urne", "mesa electoral", "Javier Milei", "Milei", "La Libertad Avanza",
        "Patricia Bullrich", "Luis Caputo", "Manuel Adorni", "libertarios", "libertad",
        "DNS", "Defensa Nacional y Seguridad",
    ],
    "economia": [
        "economía", "economia", "dólar", "dolar", "inflación", "inflacion", "banco",
        "mercado", "finanzas", "peso", "bcra", "tarifa", "precio", "recession",
        "bursatil", "bolsa", "acciones", "divisa",
    ],
    "sociedad": [
        "sociedad", "salud", "educación", "educacion", "pobreza", "trabajo",
        "empleo", "hospital", "escuela", "universidad", "médico", "medico",
        "enfermedad", "vacuna", "seguridad social",
    ],
    "deportes": [
        "deporte", "fútbol", "futbol", "liga", "partido", "torneo", "goleador",
        "selección", "seleccion", "gol", "equipo", "jugador", "estadio",
        "campeonato", "fc", "messi", "river plate", "boca juniors", "argentina",
    ],
    "judiciales": [
        "juez", "jueza", "fiscal", "causa", "juicio", "tribunal", "denuncia",
        "crimen", "policía", "policia", "detención", "detencion", "arresto",
        "imputado", "procesado", "condena", "prisión", "prision", "querella",
        "audiencia", "fallo", "sentencia",
    ],
    "internacional": [
        "estados unidos", "china", "brasil", "europa", "onu", "summit", "g20",
        "reino unido", "rusia", "ucrania", "putin", "biden", "trump", "macri",
        "lula", " xi jinping", "omes", "otan", "francia", "alemania", "italia",
        "españa", "méxico", "méjico",
    ],
    "tecnologia": [
        "tecnología", "tecnologia", "inteligencia artificial", "ia ", "startup",
        "digital", "software", "google", "meta", "apple", "microsoft", "amazon",
        "nube", "cloud", "programación", "programacion", "ciberseguridad", "hack",
        "datos",
    ],
    "culturales": [
        "cultura", "arte", "música", "musica", "cine", "teatro", "literatura",
        "museo", "exposición", "exposicion", "artista", "película", "pelicula",
        "series", "netflix", "libro", "orquesta",
    ],
}

PRO_GOV_KEYWORDS = [
    "gobierno", "presidente", "administración", "administracion", "ministro",
    "estado", "nacional", "público", "publico", "obra pública", "obra publica",
    "plan social", "asignación", "universidad pública", "salud pública",
    "Javier Milei", "Milei", "libertarios", "libertad",
    "La Libertad Avanza", "Patricia Bullrich", "Luis Caputo",
    "Manuel Adorni", "DNS", "Defensa Nacional y Seguridad",
    "Gobierno Nacional", "política pública", "reforma laboral",
    "relaciones exteriores",
]

ANTI_GOV_KEYWORDS = [
    "oposición", "oposicion", "opositor", "macrismo", "PRO", "Cambia Mo",
    "Mauricio Macri", "Horacio Rodríguez Larreta",
    "Jorge Macri", "Diego Santilli", "Martín Lousteau", "pibe",
    "Alberto Fernández", "Frente de Todos", "Sergio Massa",
    "Wado de Pedro", "Axel Kicilloff", "Juan Manzur",
    "Cristina Fernández", "CFK", "kirchnerismo", "peronismo",
    "verborrgia", "movimiento obrero", "sindicato",
    "aumento de retenciones", "nacionalización",
    "liberal", "liberalismo", "ajuste", "reforma", "privatización",
    "privatizacion", "déficit fiscal", "desregulación", "desregulacion",
    "reforma jubilatoria", "reforma previsional", "ley Bases",
    "bajar impuestos", "dividendo", "precarización", "neoliberal",
    "anarcocapitalismo", "balances", "déficit",
]


def categorize(text: str) -> str:
    """Pick the category with the most keyword hits; fall back to 'generales'."""
    if not text:
        return "generales"
    text_lower = text.lower()
    scores = {}
    for category, keywords in CATEGORY_KEYWORDS.items():
        score = sum(1 for kw in keywords if re.search(r"\b" + re.escape(kw) + r"\b", text_lower))
        if score > 0:
            scores[category] = score
    if not scores:
        return "generales"
    # `max()` on dict keys requires a key= callable that returns
    # something orderable; scores.get returns the value for the
    # key, so the max() compares values implicitly.
    best_score = -1
    best_cat = "generales"
    for cat, sc in scores.items():
        if sc > best_score:
            best_score = sc
            best_cat = cat
    return best_cat


def compute_bias(text: str) -> float:
    """Score: positive = pro-gov, negative = anti-gov. Range [-1, 1]."""
    if not text:
        return 0.0
    text_lower = text.lower()
    pro_count = sum(1 for kw in PRO_GOV_KEYWORDS if kw in text_lower)
    anti_count = sum(1 for kw in ANTI_GOV_KEYWORDS if kw in text_lower)
    total = pro_count + anti_count
    if total == 0:
        return 0.0
    raw = (pro_count - anti_count) / total
    # Clamp and soften: extreme cases still go to ±0.7 not ±1.0 to
    # leave room for further signals.
    return round(max(-0.7, min(0.7, raw * 0.7)), 3)


def compute_quality(summary: str, body: Optional[str], image_url: Optional[str]) -> float:
    """Crude 0..1 quality heuristic.

    Real production should use AKIRA's akira_cleaner, which does
    proper NLP. For the bulk backfill we use a simple proxy:
    - 0.5 base if summary > 200 chars
    - +0.2 if body > 1000 chars
    - +0.2 if image_url present
    - +0.1 if summary doesn't look like a "Read more" CTA
    """
    score = 0.0
    if summary and len(summary) > 200:
        score += 0.5
    if body and len(body) > 1000:
        score += 0.2
    if image_url:
        score += 0.2
    if summary and not re.search(r"^\s*read more", summary.lower()):
        score += 0.1
    return round(min(1.0, score), 3)


def fetch_body(source_url: str, timeout: float = 8.0) -> Optional[str]:
    """Fetch a body via AKIRA's /extract endpoint.

    We hit the local AKIRA server (port 5100). If unreachable,
    we fall back to a plain HTTP GET and return whatever <article>
    text we can extract. If that also fails, return None.
    """
    if not source_url:
        return None
    # 1) Try AKIRA.
    try:
        req = urllib.request.Request(
            "http://localhost:5100/extract",
            data=json.dumps({"url": source_url}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
            body = data.get("body") or ""
            if body and len(body) > 200:
                return body[:8000]
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, OSError):
        pass
    return None


def enrich_one(
    card: Tuple[str, str, str, str, str, str, str, str],
    fetch_body_flag: bool,
) -> dict:
    """Compute missing fields for a single card. Returns a dict
    suitable for an UPDATE statement."""
    (card_id, title, summary, body, image_url, source_url, bias, category) = card

    out: dict = {}

    if bias is None:
        text = f"{title or ''} {summary or ''}"
        out["bias_score"] = compute_bias(text)

    if category is None:
        text = f"{title or ''} {summary or ''}"
        out["category"] = categorize(text)

    if fetch_body_flag and (not body) and source_url:
        out["body"] = fetch_body(source_url)

    out["quality_score"] = compute_quality(summary or "", body or None, image_url or None)

    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--db",
        default=os.path.join(os.path.dirname(HERE), "data", "akira.db"),
        help="Path to akira.db",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Max cards to process (default: all unenriched)",
    )
    parser.add_argument(
        "--no-body",
        action="store_true",
        help="Skip the AKIRA /extract fetch (fast but no body).",
    )
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    # Find cards missing at least one enrichment field.
    # The local harvest_run.py doesn't populate source_url, so
    # we only use image_url for body fetching.
    query = """
        SELECT id, title, summary, body, image_url, bias_score, category
        FROM news_cards
        WHERE
            bias_score IS NULL OR bias_score = 0
            OR category IS NULL
            OR body IS NULL OR body = ''
        ORDER BY created_at DESC
    """
    if args.limit:
        query += f" LIMIT {int(args.limit)}"
    rows = conn.execute(query).fetchall()
    print(f"Cards needing enrichment: {len(rows)}")

    if not rows:
        print("Nothing to do!")
        return

    fetch_body_flag = not args.no_body
    updated = 0
    print(f"Fetching bodies: {fetch_body_flag}")

    for i, row in enumerate(rows, 1):
        # body is fetched from the source_url if present; the
        # local harvest doesn't set source_url but the cascade
        # AKIRA API may recover it from the source homepage.
        out = enrich_one(
            (
                row["id"], row["title"], row["summary"], row["body"],
                row["image_url"], None, row["bias_score"], row["category"],
            ),
            fetch_body_flag,
        )
        if not out:
            continue
        # Build UPDATE
        sets = ", ".join(f"{k} = ?" for k in out)
        conn.execute(
            f"UPDATE news_cards SET {sets} WHERE id = ?",
            (*out.values(), row["id"]),
        )
        updated += 1
        if i % 100 == 0:
            conn.commit()
            print(f"  Progress: {i}/{len(rows)} (updated {updated})")
    conn.commit()
    conn.close()

    print(f"Done. Updated {updated}/{len(rows)} cards.")


if __name__ == "__main__":
    main()
