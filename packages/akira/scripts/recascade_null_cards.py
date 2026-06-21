#!/usr/bin/env python3
# DEPRECATED 2026-06-20: Re-cascade classification for null cluster_id cards.
# Superseded by scripts/recluster_all_semantic.py --recluster which covers all cards including nulls.
# Do NOT run this script unless you know what you're doing. See git history
# for the implementation if you need to revive it.
#
# Original docstring preserved below for reference.
#
"""
recascade_null_cards.py - Re-cascade 65 most recent NULL category/bias_score cards through AKIRA.

This script processes news_cards that were inserted with NULL bias_score and NULL category
(after harvest_run.py was fixed to not compute these locally), applying the same
categorize() and compute_bias() logic that AKIRA's cascade uses.
"""
import sqlite3
import re
import sys

AKIRA_DB = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
LIMIT = 65

# Keyword-based category assignment (same as harvest_run.py)
CATEGORY_KEYWORDS = {
    "politica": ["gobierno", "presidente", "congreso", "senado", "diputados", "elección", "partido político", "partido politico", "político", "politico", "ministros", "decreto", "ley ", "senadora", "diputado", "boleta", "votación", "votacion", "urne", "mesa electoral", "Javier Milei", "Milei", "La Libertad Avanza", "Patricia Bullrich", "Luis Caputo", "Manuel Adorni", "libertarios", "libertad", "DNS", "Defensa Nacional y Seguridad"],
    "economia": ["economía", "economia", "dólar", "dolar", "inflación", "inflacion", "banco", "mercado", "finanzas", "peso", "bcra", "tarifa", "precio", "inflación", "recession", "bursatil", "bolsa", "acciones", "divisa"],
    "sociedad": ["sociedad", "salud", "educación", "educacion", "pobreza", "trabajo", "empleo", "hospital", "escuela", "universidad", "médico", "medico", "enfermedad", "vacuna", "seguridad social"],
    "deportes": ["deporte", "fútbol", "futbol", "liga", "partido", "torneo", "goleador", "selección", "seleccion", "gol", "equipo", "jugador", "estadio", "campeonato", "fc", "messi", "river plate", "boca juniors", "argentina"],
    "judiciales": ["juez", "jueza", "fiscal", "causa", "juicio", "tribunal", "denuncia", "crimen", "policía", "policia", "detención", "detencion", "arresto", "imputado", "procesado", "condena", "prisión", "prision", "querella", "audiencia", "fallo", "sentencia"],
    "internacional": ["estados unidos", "china", "brasil", "europa", "onu", "summit", "g20", "reino unido", "rusia", "ucrania", "putin", "biden", "trump", "macri", "lula", " xi jinping", "omes", "otan", "francia", "alemania", "italia", "españa", "méxico", "méjico"],
    "tecnologia": ["tecnología", "tecnologia", "inteligencia artificial", "ia ", "startup", "digital", "software", "google", "meta", "apple", "microsoft", "amazon", "nube", "cloud", "programación", "programacion", "ciberseguridad", "hack", "datos"],
    "culturales": ["cultura", "arte", "música", "musica", "cine", "teatro", "literatura", "museo", "exposición", "exposicion", "artista", "película", "pelicula", "series", "netflix", "libro", "orquesta"],
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


def compute_bias(text):
    """Compute bias score: positive = pro-gov, negative = anti-gov."""
    if not text:
        return 0.0
    text_lower = text.lower()
    pro_count = sum(1 for kw in PRO_GOV_KEYWORDS if kw in text_lower)
    anti_count = sum(1 for kw in ANTI_GOV_KEYWORDS if kw in text_lower)
    total = pro_count + anti_count
    if total == 0:
        return 0.0
    return round((pro_count - anti_count) / total, 3)


def categorize(text):
    """Assign a category based on keyword matching in title+summary text.
    Uses word-boundary matching to avoid false positives like 'ia' in 'Argentina'.
    """
    if not text:
        return "generales"
    text_lower = text.lower()
    if text_lower.strip() in ("# sitemap index", "sitemap index") or \
       text_lower.startswith("url discovered via sitemap"):
        return "generales"
    scores = {}
    for category, keywords in CATEGORY_KEYWORDS.items():
        score = sum(1 for kw in keywords if re.search(r'\b' + re.escape(kw) + r'\b', text_lower))
        if score > 0:
            scores[category] = score
    if not scores:
        return "generales"
    return max(scores, key=scores.get)


def main():
    print(f"AKIRA Re-Cascade: processing {LIMIT} recent NULL cards")
    print(f"Database: {AKIRA_DB}")

    conn = sqlite3.connect(AKIRA_DB)
    conn.row_factory = sqlite3.Row

    # Get 65 most recent cards with NULL category
    cards = conn.execute("""
        SELECT id, title, summary
        FROM news_cards
        WHERE category IS NULL
        ORDER BY created_at DESC
        LIMIT ?
    """, (LIMIT,)).fetchall()

    print(f"Found {len(cards)} cards with NULL category")

    if not cards:
        print("No NULL cards to process.")
        conn.close()
        return

    updated = 0
    category_dist = {}

    for card in cards:
        title = card["title"] or ""
        summary = card["summary"] or ""
        article_text = f"{title} {summary}"
        article_category = categorize(article_text)
        article_bias = compute_bias(article_text)

        conn.execute("""
            UPDATE news_cards
            SET category = ?, bias_score = ?
            WHERE id = ?
        """, (article_category, article_bias, card["id"]))

        category_dist[article_category] = category_dist.get(article_category, 0) + 1
        updated += 1

    conn.commit()
    conn.close()

    print(f"\nUpdated {updated} cards:")
    for cat, cnt in sorted(category_dist.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {cnt}")

    # Verify
    conn2 = sqlite3.connect(AKIRA_DB)
    remaining = conn2.execute("SELECT COUNT(*) FROM news_cards WHERE category IS NULL").fetchone()[0]
    total = conn2.execute("SELECT COUNT(*) FROM news_cards").fetchone()[0]
    conn2.close()
    print(f"\nVerification: {remaining} NULL category cards remaining out of {total} total")


if __name__ == "__main__":
    main()
