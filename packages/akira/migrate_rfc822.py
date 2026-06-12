#!/usr/bin/env python3
"""Migrate RFC 822 dates to ISO 8601 and backfill categories for news_cards."""
import re
import sqlite3
from datetime import datetime

AKIRA_DB = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"

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

def categorize(text):
    """Assign a category based on keyword matching in title+summary text."""
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

MONTH_MAP = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
}

def rfc822_to_iso(date_str):
    """Convert RFC 822 date like 'Tue, 05 May 2026 22:36' to ISO 8601 '2026-05-05T22:36:00'."""
    date_str = date_str.strip()
    
    # Remove day of week and comma: 'Tue, 05 May 2026 22:36' -> '05 May 2026 22:36'
    parts = date_str.split(', ', 1)
    if len(parts) > 1:
        rest = parts[1]
    else:
        rest = parts[0]
    
    # Handle GMT timezone suffix
    rest = rest.replace(' GMT', '')
    
    # Parse: '05 May 2026 22:36' or '05 May 2026 22:36:00'
    tokens = rest.split()
    
    if len(tokens) < 4:
        return None
        
    day = tokens[0].zfill(2)
    month = MONTH_MAP.get(tokens[1], '01')
    year = tokens[2]
    time_part = tokens[3]
    
    # Ensure time has seconds
    if len(time_part.split(':')) == 2:
        time_part = time_part + ':00'
    
    return f"{year}-{month}-{day}T{time_part}"

conn = sqlite3.connect(AKIRA_DB)
cursor = conn.cursor()

# Get all cards with RFC 822 dates
cursor.execute("SELECT id, published_at, category, title FROM news_cards WHERE published_at LIKE '%, %'")
rows = cursor.fetchall()
print(f"Found {len(rows)} cards with RFC 822 dates to migrate")

success = 0
failed = 0

for card_id, published_at, category, title in rows:
    # Convert date
    new_date = rfc822_to_iso(published_at)
    
    # Determine category - use title if category is null/empty
    text_for_categorize = title if title else ""
    new_category = categorize(text_for_categorize)
    
    if new_date:
        cursor.execute(
            "UPDATE news_cards SET published_at = ?, category = ? WHERE id = ?",
            (new_date, new_category, card_id)
        )
        success += 1
    else:
        print(f"Failed to parse date for {card_id}: {published_at}")
        failed += 1

conn.commit()
conn.close()
print(f"\nMigration complete: {success} updated, {failed} failed")