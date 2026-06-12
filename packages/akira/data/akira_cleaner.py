#!/usr/bin/env python3
"""AKIRA Cleaner v6.0 - Batch Quality Filter."""
import sqlite3, re, time, json
from datetime import datetime

AKIRA_DB = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"

# Keyword-based category assignment
CATEGORY_KEYWORDS = {
    "politica": ["gobierno", "presidente", "congreso", "senado", "diputados", "elección", "partido político", "partido politico", "político", "politico", "ministros", "decreto", "ley ", "senadora", "diputado", "boleta", "votación", "votacion", "urne", "mesa electoral"],
    "economia": ["economía", "economia", "dólar", "dolar", "inflación", "inflacion", "banco", "mercado", "finanzas", "peso", "bcra", "tarifa", "precio", "inflación", "recession", "bursatil", "bolsa", "acciones", "divisa"],
    "sociedad": ["sociedad", "salud", "educación", "educacion", "pobreza", "trabajo", "empleo", "hospital", "escuela", "universidad", "médico", "medico", "enfermedad", "vacuna", "seguridad social"],
    "deportes": ["deporte", "fútbol", "futbol", "liga", "partido", "torneo", "goleador", "selección", "seleccion", "gol", "equipo", "jugador", "estadio", "campeonato", "fc", "messi", "river plate", "boca juniors", "argentina"],
    "judiciales": ["juez", "jueza", "fiscal", "causa", "juicio", "tribunal", "denuncia", "crimen", "policía", "policia", "detención", "detencion", "arresto", "imputado", "procesado", "condena", "prisión", "prision", "querella", "audiencia", "fallo", "sentencia"],
    "internacional": ["estados unidos", "china", "brasil", "europa", "onu", "summit", "g20", "reino unido", "rusia", "ucrania", "putin", "biden", "trump", "macri", "lula", " xi jinping", "omes", "otan", "francia", "alemania", "italia", "españa", "méxico", "méjico"],
    "tecnologia": ["tecnología", "tecnologia", "inteligencia artificial", "ia ", "startup", "digital", "software", "google", "meta", "apple", "microsoft", "amazon", "nube", "cloud", "programación", "programacion", "ciberseguridad", "hack", "datos"],
    "culturales": ["cultura", "arte", "música", "musica", "cine", "teatro", "literatura", "museo", "exposición", "exposicion", "artista", "película", "pelicula", "series", "netflix", "libro", "orquesta"],
}

def categorize(text):
    """Assign a category based on keyword matching in title+summary text."""
    if not text:
        return "generales"
    text_lower = text.lower()
    scores = {}
    for category, keywords in CATEGORY_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in text_lower)
        if score > 0:
            scores[category] = score
    if not scores:
        return "generales"
    return max(scores, key=scores.get)

REJECTION_PATTERNS = {
    "obituarios": [
        re.compile(r'\bfalleció\b|\bfallece\b|\bmurió\b|\bmurio\b', re.I),
        re.compile(r'\bvelatorio\b|\bfuneral\b|\bsepelio\b|\bcondolencias\b', re.I),
        re.compile(r'\bQEPD\b|\bq\.e\.p\.d\b', re.I),
    ],
    "horoscopos": [
        re.compile(r'\bhoróscopo\b|\bhoroscopo\b|\bsigno\b.*\bzodíaco\b', re.I),
        re.compile(r'\baries\b|\btauro\b|\bgéminis\b|\bcáncer\b|\bleo\b|\bvirgo\b', re.I),
        re.compile(r'\blibra\b|\bescorpio\b|\bsagitario\b|\bcapricornio\b|\bacuario\b|\bpiscis\b', re.I),
    ],
    "farmacias": [
        re.compile(r'\bfarmacia\b.*\bturno\b|\bguardia\b.*\bfarmacéutica\b', re.I),
        re.compile(r'\bfarmacia\b.*\babierta\b|\bfarmacia\b.*\b24\s*hs\b', re.I),
    ],
    "spam": [
        re.compile(r'\bclick\s*aquí\b|\bhaz\s*clic\b|\bsuscríbete\s*ahora\b', re.I),
        re.compile(r'\bgana\s*dinero\b|\btrabaja\s*desde\s*casa\b', re.I),
    ],
    "publicidad_pagada": [
        re.compile(r'\bnota\s*pagada\b|\bcontenido\s*publicitario\b', re.I),
        re.compile(r'\bpatrocinado\b|\bpublicidad\b.*\bnota\b', re.I),
    ],
    "clasificados": [
        re.compile(r'\bse\s*vende\b|\bse\s*alquila\b|\bse\s*subasta\b', re.I),
        re.compile(r'\bempleo\b.*\bse\s*busca\b|\bse\s*busca\b.*\bempleo\b', re.I),
    ],
}

GACETILLA_PATTERNS = [
    re.compile(r'\b(?:excelente|maravilloso|increíble|sin precedentes|histórico|extraordinario)\b.*\bgobierno\b', re.I),
    re.compile(r'\bgobierno\b.*(?:inauguración|apertura|lanzamiento|presentación|discurso)\b', re.I),
    re.compile(r'\b(?:participó|estuvo\s+presente|acompañ[oó])\s+.*(?:inauguración|apertura|lanzamiento)\b', re.I),
    re.compile(r'\b(?:autoridades?|funcionarios?)\s+.*(?:inauguró|presentó|anunció|destacó)\b', re.I),
    re.compile(r'\b(?:fuente|inform[oó]|prensa)\s*:\s*(?:oficina|ministerio|secretaría)\b', re.I),
]

def get_rejection_type(title, summary):
    text = f"{title} {summary or ''}"
    for name, patterns in REJECTION_PATTERNS.items():
        for pattern in patterns:
            if pattern.search(text):
                return name
    return None

def detect_gacetilla(title, summary):
    text = f"{title} {summary or ''}"
    return any(p.search(text) for p in GACETILLA_PATTERNS)

def compute_quality(item):
    item_id, title, summary, bias_score, is_gacetilla, published_at, category, gacetilla_confidence = item

    rejection = get_rejection_type(title, summary)
    if rejection:
        return item_id, 0.1, 1, rejection

    score = 0.7
    is_gacet_flag = 1 if (is_gacetilla or 0) else 0

    if len(title) < 30: score -= 0.15
    elif len(title) > 80: score -= 0.05
    if len(summary or '') < 50: score -= 0.25
    elif len(summary or '') > 300: score += 0.1

    if category in ["judiciales", "política", "economía"]: score += 0.05
    elif category in ["espectáculos", "farándula", "social"]: score -= 0.1

    if is_gacetilla or (gacetilla_confidence and gacetilla_confidence > 0.5):
        score -= 0.35; is_gacet_flag = 1

    if detect_gacetilla(title, summary):
        score -= 0.25; is_gacet_flag = 1

    if abs(bias_score or 0) > 0.7: score -= 0.15

    return item_id, max(0.0, min(1.0, round(score, 2))), is_gacet_flag, None

def main():
    start_time = time.time()

    conn = sqlite3.connect(AKIRA_DB)
    items = conn.execute("""
        SELECT id, title, summary, bias_score, is_gacetilla,
               published_at, category, gacetilla_confidence
        FROM news_cards
        WHERE quality_score IS NULL
        LIMIT 200
    """).fetchall()
    conn.close()

    if not items:
        print(json.dumps({"status": "no_items", "items_processed": 0}))
        return

    print(f"Items to clean: {len(items)}")

    batch_updates = []
    rejections = {}

    for item in items:
        item_id, quality, is_gacet, rejection = compute_quality(item)
        batch_updates.append((quality, is_gacet, item_id))
        if rejection:
            rejections[rejection] = rejections.get(rejection, 0) + 1

    conn = sqlite3.connect(AKIRA_DB)
    conn.execute("BEGIN IMMEDIATE")
    for quality, is_gacet, item_id in batch_updates:
        conn.execute("""
            UPDATE news_cards SET quality_score = ?, is_gacetilla = ? WHERE id = ?
        """, (quality, is_gacet, item_id))
    conn.commit()
    conn.close()

    elapsed = time.time() - start_time
    print(json.dumps({
        "cycle_started": datetime.utcnow().isoformat() + "Z",
        "items_processed": len(items),
        "rejections": rejections,
        "batch_update_count": len(batch_updates),
        "cycle_duration_s": round(elapsed, 2)
    }))

if __name__ == "__main__":
    main()