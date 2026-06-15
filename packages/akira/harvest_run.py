#!/usr/bin/env python3
"""AKIRA Harvester v12.0 - Delta extraction with domain-aware rate limiting."""
import re, sqlite3, json, uuid, asyncio, aiohttp, time, os, sys
from datetime import datetime
from urllib.parse import urlparse
from collections import defaultdict
from email.utils import parsedate_to_datetime

# Add the package root to sys.path so we can import the byline
# extractor from extractors/base.py. The harvester runs as a
# standalone script; without this the import below would fail
# when invoked outside the package.
_PKG_ROOT = os.path.dirname(os.path.abspath(__file__))
if _PKG_ROOT not in sys.path:
    sys.path.insert(0, _PKG_ROOT)
from extractors.base import extract_byline, MAX_AUTHOR_LEN  # noqa: E402
from extractors._slug import make_slug  # noqa: E402

def _parse_date(value):
    if not value:
        return None
    if isinstance(value, str):
        value = value.strip()
        if value[0] == "2" and ("T" in value or "-" in value):
            return value[:19] if "T" in value else value[:10]
        try:
            dt = parsedate_to_datetime(value)
            return dt.strftime("%Y-%m-%dT%H:%M:%S")
        except Exception:
            pass
    return None


def _get_existing_slugs_for_date(conn, slug_date: str) -> set[str]:
    """Return the set of slugs already used on a given slug_date. Used to
    resolve collisions before INSERT (Phase 2 Task 24)."""
    rows = conn.execute(
        "SELECT slug FROM news_cards WHERE slug_date = ? AND slug != ''",
        (slug_date,),
    ).fetchall()
    return {r[0] for r in rows}


def _resolve_slug_collision(base_slug: str, existing: set[str], article_id: str) -> str:
    """Append the first 6 chars of the article id (then -2, -3, …) until
    the candidate is unique within `existing`. The candidate is also added
    to `existing` in-place so subsequent calls in the same batch see it."""
    suffix = (article_id or "x")[:6].lower()
    candidate = f"{base_slug}-{suffix}"
    if candidate not in existing:
        return candidate
    i = 2
    while f"{base_slug}-{suffix}-{i}" in existing:
        i += 1
    return f"{base_slug}-{suffix}-{i}"

AKIRA_DB = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
AKIRA_API = os.getenv("AKIRA_API_URL", "http://localhost:5100/extract")
MAX_CONCURRENT = 2
RATE_LIMIT = 2.0
TIMEOUT = 60.0

# Keyword-based category assignment
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

# Keyword-based bias scoring (pro-gov vs anti-gov, Argentine political context)
# Milei era (2024-2025): PRO_GOV = La Libertad Avanza / ANTI_GOV = Peronismo/Kirchnerismo + opposition
PRO_GOV_KEYWORDS = [
    "gobierno", "presidente", "administración", "administracion", "ministro",
    "estado", "nacional", "público", "publico", "obra pública", "obra publica",
    "plan social", "asignación", "universidad pública", "salud pública",
    # Milei-era government keywords
    "Javier Milei", "Milei", "libertarios", "libertad",
    "La Libertad Avanza", "Patricia Bullrich", "Luis Caputo",
    "Manuel Adorni", "DNS", "Defensa Nacional y Seguridad",
    "Gobierno Nacional", "política pública", "reforma laboral",
    "relaciones exteriores",
]
ANTI_GOV_KEYWORDS = [
    # Opposition / other parties
    "oposición", "oposicion", "opositor", "macrismo", "PRO", "Cambia Mo",
    "Mauricio Macri", "Horacio Rodríguez Larreta",
    "Jorge Macri", "Diego Santilli", "Martín Lousteau", "pibe",
    # Fernández-era figures (now anti-gov)
    "Alberto Fernández", "Frente de Todos", "Sergio Massa",
    "Wado de Pedro", "Axel Kicilloff", "Juan Manzur",
    "Cristina Fernández", "CFK", "kirchnerismo", "peronismo",
    "verborrgia", "movimiento obrero", "sindicato",
    "aumento de retenciones", "nacionalización",
    # Policy critique keywords
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
    # Filter out sitemap artifacts before categorization
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

conn = sqlite3.connect(AKIRA_DB)
# Use consecutive_failures from source_health as the
# active-failure signal rather than the historical
# sources.error_count, which is cumulative. A source
# with 5 historical errors but 0 recent failures is
# healthy; a source with 0 historical errors but 5
# recent failures is genuinely broken.
sources = conn.execute("""
    SELECT s.id, s.name, s.url, s.location_id, s.rss_url
    FROM sources s
    JOIN source_health h ON s.id = h.source_id
    WHERE s.is_active = 1
    AND h.is_circuit_open = 0
    AND COALESCE(h.consecutive_failures, 0) < 5
    AND COALESCE(s.error_count, 0) < 5
""").fetchall()
conn.close()

domains = defaultdict(list)
for source_id, name, url, location_id, rss_url in sources:
    domain = urlparse(url).netloc
    domains[domain].append((source_id, name, url, location_id, rss_url))

# Convert to plain dict to avoid comprehension scope issues
domains = dict(domains)

print(f"Total sources: {len(sources)} | Domains: {len(domains)} | Concurrency: {MAX_CONCURRENT}")

stats = {"items": 0, "sources_with_items": 0, "errors": 0, "start": time.monotonic()}

domain_semaphores = {d: asyncio.Semaphore(1) for d in domains}
domain_last_fetch = {d: 0.0 for d in domains}

async def fetch_url(session, target_url, source_id, rss_url):
    payload = json.dumps({"url": target_url, "source_id": source_id}).encode()
    headers = {"Content-Type": "application/json"}
    try:
        async with session.post(AKIRA_API, data=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=TIMEOUT)) as resp:
            if resp.status != 200:
                return None
            result = await resp.json()
            items = result.get("items", [])
            if items or not rss_url:
                return items
            return None
    except Exception:
        return None

async def extract_with_fallback(session, source_id, name, url, location_id, rss_url):
    domain = urlparse(url).netloc
    sem = domain_semaphores[domain]
    async with sem:
        now = time.monotonic()
        wait = RATE_LIMIT - (now - domain_last_fetch[domain])
        if wait > 0:
            await asyncio.sleep(wait)
        domain_last_fetch[domain] = time.monotonic()
        result = await fetch_url(session, url, source_id, rss_url)
        if result is None:
            result = await fetch_url(session, url.rstrip("/") + "/sitemap.xml", source_id, None)
        return (source_id, name, url, location_id, rss_url, result)

async def process_sources():
    connector = aiohttp.TCPConnector(limit=MAX_CONCURRENT, limit_per_host=1)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = []
        for domain, domain_sources in domains.items():
            for source_id, name, url, location_id, rss_url in domain_sources:
                extract_url = rss_url if rss_url else url.rstrip("/") + "/rss/"
                task = extract_with_fallback(session, source_id, name, extract_url, location_id, rss_url)
                tasks.append(task)
        results = await asyncio.gather(*tasks, return_exceptions=True)
        conn2 = sqlite3.connect(AKIRA_DB)
        for res in results:
            if isinstance(res, Exception):
                stats["errors"] += 1
                continue
            source_id, name, url, location_id, rss_url, items = res
            if items:
                stats["sources_with_items"] += 1
                stats["items"] += len(items)
                for item in items:
                    article_id = str(uuid.uuid5(uuid.NAMESPACE_URL, item.get("url", "")))
                    # Byline / author (S3.7). The cascade's RSS
                    # feed usually exposes the author; if not,
                    # we still get a free shot via the byline
                    # regex on the page HTML when the extractor
                    # provides it under item['html'].
                    # extract_byline clamps to MAX_AUTHOR_LEN; we
                    # apply the same cap to the RSS-supplied
                    # author so the DB column never overflows.
                    author = (item.get("author") or "").strip()[:MAX_AUTHOR_LEN]
                    if not author and item.get("html"):
                        author = extract_byline(item["html"])
                    # Persist the article body when the
                    # extractor (newspaper/jina/playwright/
                    # content:encoded RSS) has one. The
                    # article page reads this instead of the
                    # truncated summary. The body column is
                    # added in the next migration.
                    body = item.get("body") or item.get("text") or None
                    if body:
                        body = body[:8000]
                    # article_url = the per-item URL from the
                    # RSS feed (e.g. https://example.com/news/foo).
                    # Stored separately from source_url (which
                    # the sync layer will overwrite with the
                    # source homepage) so re-extraction jobs
                    # have the exact link to re-fetch.
                    article_url = item.get("url", "")[:500] or None
                    # SEO slug + slug_date (Phase 2 Task 24). The
                    # canonical URL on Antena is
                    # `/noticia/{slug_date}/{slug}`. We compute the
                    # slug from the title and resolve collisions
                    # against any existing cards on the same date
                    # so the (slug_date, slug) unique index never
                    # trips the harvester mid-batch.
                    published_iso = _parse_date(item.get("published_at")) or datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
                    slug_date = published_iso[:10]
                    existing_slugs = _get_existing_slugs_for_date(conn2, slug_date)
                    slug = make_slug(item.get("title", ""))
                    if slug in existing_slugs:
                        slug = _resolve_slug_collision(slug, existing_slugs, article_id)
                    # bias_score and category left NULL — AKIRA cascade will enrich them
                    conn2.execute("""
                        INSERT OR IGNORE INTO news_cards
                        (id, location_id, title, summary, body, image_url, source_url, article_url, source_ids, bias_score, published_at, created_at, category, author, slug, slug_date)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, datetime("now"), NULL, ?, ?, ?)
                    """, (
                        article_id, location_id,
                        # Title cap raised from 500 → 1000 so
                        # long Spanish titles (which often
                        # run 100-200 chars with subhead) are
                        # not truncated before they reach the
                        # user.
                        item.get("title", "")[:1000],
                        # Summary cap raised from 1000 → 2500
                        # so feed items with content:encoded
                        # or longer <description> blocks
                        # actually reach the user. Most
                        # modern feeds cap their lede at
                        # ~1500-2000 chars; this matches.
                        item.get("summary", "")[:2500],
                        body,
                        item.get("image_url"),
                        item.get("url", "")[:500],
                        article_url,
                        str(source_id),
                        published_iso,
                        author,
                        slug,
                        slug_date,
                    ))
                # Track the per-source yield.
                items_count = len(items) if items else 0
                conn2.execute("""
                    UPDATE sources SET fetch_count=fetch_count+1, news_count=news_count+?, last_fetch=datetime("now"), last_success=datetime("now"), error_count=0
                    WHERE id=?
                """, (items_count, source_id,))
            else:
                conn2.execute("""
                    UPDATE sources SET fetch_count=fetch_count+1, last_fetch=datetime("now"), error_count=error_count+1
                    WHERE id=?
                """, (source_id,))
        conn2.commit()
        conn2.close()

asyncio.run(process_sources())

elapsed = time.monotonic() - stats["start"]
print(f"Done: {stats['sources_with_items']}/{len(sources)} sources | {stats['items']} articles | {stats['errors']} errors | {elapsed:.0f}s")