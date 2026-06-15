"""SEO-friendly slug generation for news article URLs.

Produces URL-safe slugs from Spanish (or any Latin-script) titles:
- ASCII-normalized (accents stripped, ñ→n)
- Lowercase
- Stopwords removed
- 7 words max by default
- 60 chars total max
"""
import re
import unicodedata
from typing import Final

STOPWORDS: Final[frozenset[str]] = frozenset({
    "a", "al", "con", "de", "del", "e", "el", "en", "es", "esa", "ese",
    "esta", "este", "esto", "ha", "han", "hay", "la", "las", "le", "lo",
    "los", "o", "para", "por", "que", "se", "sin", "son", "su", "sus",
    "un", "una", "unas", "uno", "unos", "u", "y", "fue", "sobre", "tras",
    "desde", "hasta", "como", "mas", "pero", "ya", "les", "me", "te", "nos",
})

_FALLBACK_SLUG: Final[str] = "sin-titulo"
_MAX_WORDS: Final[int] = 7
_MAX_CHARS: Final[int] = 60


def _strip_accents(s: str) -> str:
    """'Dólar' → 'Dolar', 'Niño' → 'Nino'."""
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def make_slug(title: str, max_words: int = _MAX_WORDS) -> str:
    """Generate an SEO-friendly slug from a title.

    Examples:
        >>> make_slug("Dólar blue HOY: cierre a $1.245")
        'dolar-blue-hoy-cierre-1245'
        >>> make_slug("El gobierno de Argentina anunció nuevas medidas")
        'gobierno-argentina-anuncio-nuevas-medidas'
        >>> make_slug("2026 noticias")
        '2026-noticias'
    """
    if not title or not title.strip():
        return _FALLBACK_SLUG

    text = _strip_accents(title.lower())
    text = re.sub(r"[^a-z0-9\s]", "", text)
    text = re.sub(r"\s+", " ", text).strip()

    words = [w for w in text.split() if w and w not in STOPWORDS]
    if not words:
        return _FALLBACK_SLUG

    slug = "-".join(words[:max_words])

    if len(slug) > _MAX_CHARS:
        slug = slug[:_MAX_CHARS].rsplit("-", 1)[0]

    return slug or _FALLBACK_SLUG
