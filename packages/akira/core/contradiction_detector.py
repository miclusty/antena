"""Contradiction detection — surfaces numerical/factual disagreements
between sources covering the same news cluster.

Use case: cluster about "incendio en Córdoba" has 5 sources:
- Source A: "5 muertos, 200 evacuados"
- Source B: "8 muertos, 300 evacuados"

The detector finds both the death-toll and evacuation-count disagreements,
grouping claims by (subject, unit) so unrelated numbers (5 muertos vs
5 kilómetros) don't cross-pollute.

Spanish-aware regex handles:
- thousands: 1.234 (es) / 1,234 (en)
- decimals: 1,5 (es) / 1.5 (en)
- magnitude suffixes: mil, millones, billones
- currency markers: $, pesos, dólares
- Spanish number words: cinco, doscientos, mil

The detector is intentionally conservative — it only flags HIGH-CONFIDENCE
contradictions (multiple distinct sources with different values for the
same normalized subject). Single-source deltas are returned with low
confidence so downstream consumers can filter them.
"""
from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field, asdict
from typing import Iterable


# ─── Spanish number words (basic set) ─────────────────────────────
_SPANISH_NUMBERS: dict[str, int] = {
    "cero": 0, "un": 1, "uno": 1, "una": 1, "dos": 2, "tres": 3,
    "cuatro": 4, "cinco": 5, "seis": 6, "siete": 7, "ocho": 8,
    "nueve": 9, "diez": 10, "once": 11, "doce": 12, "trece": 13,
    "catorce": 14, "quince": 15, "dieciseis": 16, "dieciséis": 16,
    "diecisiete": 17, "dieciocho": 18, "diecinueve": 19, "veinte": 20,
    "veintiuno": 21, "veintidos": 22, "veintidós": 22, "veintitres": 23,
    "veintitrés": 23, "veinticuatro": 24, "veinticinco": 25,
    "veintiseis": 26, "veintiséis": 26, "veintisiete": 27,
    "veintiocho": 28, "veintinueve": 29, "treinta": 30, "cuarenta": 40,
    "cincuenta": 50, "sesenta": 60, "setenta": 70, "ochenta": 80,
    "noventa": 90, "cien": 100, "ciento": 100, "doscientos": 200,
    "trescientos": 300, "cuatrocientos": 400, "quinientos": 500,
    "seiscientos": 600, "setecientos": 700, "ochocientos": 800,
    "novecientos": 900, "mil": 1000,
}

# Compound words: "doscientos", "trescientos" — covered above.
# For 100-999 composites we keep the simpler mapping; "doscientos" +
# unconnected "+cinco" wouldn't parse. The detector doesn't try to
# reconstruct "doscientos cinco" → 205 — those values are rare enough
# in news copy that we accept the miss. (If you need it, see
# esnum package or write a small parser.)

_SPANISH_NUM_WORDS_RE = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in sorted(_SPANISH_NUMBERS.keys(), key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)


# ─── Subject vocabulary (Spanish) ─────────────────────────────────
# Patterns of "<noun> [<preposition> [<noun>]]" that map to a
# normalized subject key. Adding to this list is the easiest way to
# teach the detector about a new fact type.
#
# Each entry: (regex_after_number, normalized_subject, default_unit)
#
# Order matters: more-specific patterns first. We also include
# post-suffix patterns like "\s+de\s+(\w+)" so that after the
# magnitude suffix ("millones") has been consumed by the suffix
# detector, the trailing noun ("de pesos") still maps correctly.
_SUBJECT_PATTERNS: list[tuple[str, str, str | None]] = [
    # ── Magnitude + noun combos (matched when suffix is NOT consumed separately)
    (r"\s+millones?\s+de\s+(\w+)", "millon_{noun}", None),
    (r"\s+mil\s+(\w+)", "mil_{noun}", None),
    (r"\s+millones?\b", "millon", None),
    (r"\s+mil\b", "mil", None),
    # ── Post-suffix: "millones de pesos" already consumed "millones"
    (r"\s+de\s+pesos?", "peso", "ARS"),
    (r"\s+de\s+d[oó]lares?", "dolares", "USD"),
    (r"\s+de\s+euros?", "euro", "EUR"),
    # ── Percentages
    (r"\s*%|por\s+ciento", "porcentaje", "%"),
    # ── Generic noun subjects (with optional preposition link)
    (r"\s+muert[oa]s?", "muerto", None),
    (r"\s+herid[oa]s?", "herido", None),
    (r"\s+evacuad[oa]s?", "evacuado", None),
    (r"\s+damnificad[oa]s?", "damnificado", None),
    (r"\s+detenid[oa]s?", "detenido", None),
    (r"\s+arrestad[oa]s?", "detenido", None),
    (r"\s+desaparecid[oa]s?", "desaparecido", None),
    (r"\s+herid[oa]s?\s+graves?", "herido_grave", None),
    (r"\s+contagiad[oa]s?", "contagiado", None),
    (r"\s+infectad[oa]s?", "infectado", None),
    (r"\s+fallecid[oa]s?", "muerto", None),
    (r"\s+victimas?", "victima", None),
    (r"\s+personas?", "persona", None),
    (r"\s+familias?", "familia", None),
    (r"\s+ninos|nin[oa]s?", "nino", None),
    (r"\s+menores\s+de\s+edad", "menor", None),
    (r"\s+pesos\s+argentinos?", "peso", "ARS"),
    (r"\s+pesos?", "peso", "ARS"),
    (r"\s+d[oó]lares?", "dolares", "USD"),
    (r"\s+euros?", "euro", "EUR"),
    (r"\s+bolivianos?", "boliviano", None),
    (r"\s+cent[íi]metros?", "centimetro", None),
    (r"\s+metros?", "metro", None),
    (r"\s+kil[óo]metros?", "kilometro", None),
    (r"\s+km(?:\b|$)", "kilometro", None),
    (r"\s+hect[áa]reas?", "hectarea", None),
    (r"\s+grados?", "grado", None),
    (r"\s+cuartos?", "cuarto", None),
    (r"\s+d[íi]as?", "dia", None),
    (r"\s+meses?", "mes", None),
    (r"\s+a[ñn]os?", "ano", None),
    (r"\s+horas?", "hora", None),
    (r"\s+minutos?", "minuto", None),
    (r"\s+segundos?", "segundo", None),
    (r"\s+veces?", "vez", None),
    (r"\s+casas?", "casa", None),
    (r"\s+edificios?", "edificio", None),
    (r"\s+veh[íi]culos?", "vehiculo", None),
    (r"\s+autos?", "vehiculo", None),
    (r"\s+coches?", "vehiculo", None),
    (r"\s+motos?", "vehiculo", None),
    (r"\s+camiones?", "vehiculo", None),
    (r"\s+helic[óo]pteros?", "vehiculo", None),
    (r"\s+aviones?", "vehiculo", None),
    (r"\s+barcos?", "vehiculo", None),
    (r"\s+kilogramos?", "kilogramo", None),
    (r"\s+toneladas?", "tonelada", None),
    (r"\s+hectolitros?", "hectolitro", None),
    (r"\s+litros?", "litro", None),
]


# ─── Number regex ─────────────────────────────────────────────────
# Matches: 5, 1.234, 1,5, 1,234.5, 1.5
# Spanish thousands: 1.234 (3 digits after dot)
# Spanish decimals: 1,5 (single comma-decimal)
#
# We try BOTH conventions and let parse_spanish_number decide.
_NUMBER_RE = re.compile(
    r"(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+[.,]\d+|\d+)"
)


# ─── Public dataclasses ───────────────────────────────────────────


@dataclass
class NumericClaim:
    value: float
    subject: str
    unit: str | None
    source: str
    raw_text: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Contradiction:
    subject: str
    unit: str | None
    entries: list[dict]  # [{source, value, raw_text}, ...]
    confidence: float

    def to_dict(self) -> dict:
        return {
            "subject": self.subject,
            "unit": self.unit,
            "values": sorted({e["value"] for e in self.entries}),
            "entries": self.entries,
            "confidence": round(self.confidence, 2),
        }


# ─── Public API ───────────────────────────────────────────────────


def parse_spanish_number(raw: str, suffix: str | None = None) -> float | None:
    """Parse a Spanish-formatted number string into a float.

    Handles:
    - thousands: "1.234" → 1234, "10.000" → 10000
    - decimals: "1,5" → 1.5, "1.5" → 1.5
    - thousands + decimals: "1.234,5" → 1234.5
    - magnitude suffix: "mil", "millones", "billones"

    Returns None if the string is empty or unparseable.
    """
    if not raw:
        return None
    s = raw.strip()

    # Heuristic: if the string contains a comma followed by exactly
    # 3 digits, that's a thousands separator (en convention).
    # If the comma is followed by 1-2 digits, it's a decimal (es).
    # If the dot is followed by exactly 3 digits, thousands (es).
    # If the dot is followed by 1-2 digits, decimal (en).
    has_comma = "," in s
    has_dot = "." in s

    if has_comma and has_dot:
        # Whichever comes LAST is the decimal separator
        if s.rfind(",") > s.rfind("."):
            # es: 1.234,5
            s = s.replace(".", "").replace(",", ".")
        else:
            # en: 1,234.5
            s = s.replace(",", "")
    elif has_comma:
        # Look at the part after the comma
        after = s.split(",", 1)[1]
        if len(after) == 3 and after.isdigit():
            # en thousands: 1,234
            s = s.replace(",", "")
        else:
            # es decimal: 1,5
            s = s.replace(",", ".")
    elif has_dot:
        after = s.split(".", 1)[1]
        if len(after) == 3 and after.isdigit():
            # es thousands: 1.234
            s = s.replace(".", "")
        # else: en decimal, leave as-is

    try:
        value = float(s)
    except ValueError:
        return None

    if suffix:
        suffix_lower = suffix.lower()
        if suffix_lower == "mil":
            value *= 1_000
        elif suffix_lower in ("millon", "millones", "millón"):
            value *= 1_000_000
        elif suffix_lower in ("billon", "billones", "billón"):
            value *= 1_000_000_000

    return value


def _strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if not unicodedata.combining(c)
    )


def normalize_subject(s: str) -> str:
    """Lowercase, strip accents, normalize plurals and gender.

    Rules (applied per word):
    - lowercase + strip combining marks
    - "muertos" → "muerto" (drop trailing -s for plurals)
    - "heridas" → "herido" (drop plural -s, then convert feminine
      participle endings -ida/-ada/-ída to -ido/-ado so adjective
      subjects collapse regardless of gender agreement)

    "persona" stays as "persona" because -a is the noun stem, not a
    participle ending. We can't tell apart "persona" (noun) from
    "herida" (participle) without a dictionary, so we use a simple
    heuristic: only convert -a to -o when the word ends in
    -ida/-ada/-ída/-ída/-ída (participle pattern).
    """
    norm = _strip_accents(s.lower().strip())
    words = norm.split()
    out = []
    for w in words:
        # Drop plural -s first
        if w.endswith("es") and len(w) > 4:
            # "muertes" stays as "muertes" (don't over-strip)
            base = w
        elif w.endswith("s") and len(w) > 3:
            base = w[:-1]
        else:
            base = w

        # Convert feminine participle endings to masculine
        if base.endswith(("ida", "ada", "ida")) and len(base) > 4:
            # "herida" → "herido", "evacuada" → "evacuado"
            base = base[:-1] + "o"

        out.append(base)
    return " ".join(out)


def _match_subject(text_after_number: str) -> tuple[str, str | None] | None:
    """Given the text immediately after a parsed number, return the
    matched (normalized_subject, unit) or None if no pattern matches.
    """
    # Try patterns from most-specific to least-specific so that
    # "5 millones de pesos" matches "millones de pesos" rather than
    # just "millones".
    for pattern, subject_template, default_unit in _SUBJECT_PATTERNS:
        m = re.match(pattern, text_after_number, re.IGNORECASE)
        if not m:
            continue

        if "{noun}" in subject_template and m.groups():
            noun = normalize_subject(m.group(1))
            subject = subject_template.format(noun=noun)
        else:
            subject = subject_template

        # Detect percentage / currency unit from the surrounding text
        unit = default_unit
        if "$" in text_after_number[:20] or "pesos" in text_after_number[:20]:
            unit = unit or "ARS"
        if "dólares" in text_after_number[:20] or "dolares" in text_after_number[:20]:
            unit = "USD"
        if "euros" in text_after_number[:20]:
            unit = "EUR"

        return normalize_subject(subject), unit

    return None


def _detect_currency(text: str, pos: int) -> str | None:
    """Look 3 chars before `pos` for a currency marker and return
    the unit ('USD', 'ARS', 'EUR', or None).

    Handles: $, US$, U$S, $, u$s
    """
    window = text[max(0, pos - 5): pos].lower()
    # Strip spaces — U$S is sometimes written as "u$s" or "U $ S"
    win_compact = window.replace(" ", "")
    if "u$s" in win_compact or "us$" in win_compact:
        return "USD"
    if "$" in window or "$" in win_compact:
        return "ARS"
    return None


def extract_numeric_claims(text: str, source: str) -> list[NumericClaim]:
    """Find all (number, subject, unit) claims in a piece of text.

    The text is scanned with a number regex. After each match, the
    trailing chunk is matched against the subject vocabulary to
    decide what the number refers to. If no subject matches, the
    claim is dropped (a bare "5" with no noun is ambiguous).

    Spanish number words (cinco, doscientos) are recognized too.
    """
    if not text:
        return []

    claims: list[NumericClaim] = []

    # Detect currency markers once for the whole text (used to tag
    # the unit on claims that come right after "$" or "US$").
    def _currency_unit_around(start: int) -> str | None:
        window = text[max(0, start - 4): start + 30].lower()
        if "u$s" in window or "usd" in window:
            return "USD"
        if "u$s" in window.replace(" ", "") or "us$" in window:
            return "USD"
        if "$" in text[max(0, start - 3): start] and ("dólar" in window or "dollar" in window):
            return "USD"
        if "$" in text[max(0, start - 3): start]:
            # Default to ARS for "$" in Argentine news context
            return "ARS"
        if "euros" in window or "€" in text[max(0, start - 3): start]:
            return "EUR"
        return None

    # Numeric forms
    for m in _NUMBER_RE.finditer(text):
        raw_num = m.group(1)
        suffix = None
        # Look ahead for magnitude suffix within 12 chars
        after = text[m.end(): m.end() + 20]
        sm = re.match(r"\s*(mil|mill[oó]n(?:es)?|bill[oó]n(?:es)?)\b", after, re.IGNORECASE)
        if sm:
            suffix = sm.group(1)

        value = parse_spanish_number(raw_num, suffix=suffix)
        if value is None:
            continue

        text_after = text[m.end():]
        match = _match_subject(text_after)
        if not match:
            continue
        subject, unit = match

        # Currency tag from context (overrides default subject unit).
        # When the magnitude suffix was consumed AND currency is
        # implied, enrich the subject key so the UI can render
        # "millón de pesos" instead of just "millón".
        currency = _detect_currency(text, m.start())
        if currency:
            unit = currency
            # If subject is bare "millon" or "mil", append currency
            if subject in ("millon", "mil"):
                subject = f"{subject}_ARS" if currency == "ARS" else f"{subject}_{currency}"

        # Pull a short excerpt (number + subject noun) for debugging
        end = m.end()
        # extend up to the next sentence boundary or ~80 chars
        tail = text[m.start(): m.start() + 80]
        cut = re.search(r"[.;\n]", tail[len(raw_num):])
        if cut:
            tail = tail[: len(raw_num) + cut.start()]

        claims.append(NumericClaim(
            value=value,
            subject=subject,
            unit=unit,
            source=source,
            raw_text=tail.strip(),
        ))

    # Spanish number words
    for m in _SPANISH_NUM_WORDS_RE.finditer(text):
        word = m.group(1).lower()
        if word not in _SPANISH_NUMBERS:
            continue
        value = float(_SPANISH_NUMBERS[word])
        text_after = text[m.end():]
        match = _match_subject(text_after)
        if not match:
            continue
        subject, unit = match

        currency = _detect_currency(text, m.start())
        if currency:
            unit = currency
            if subject in ("millon", "mil"):
                subject = f"{subject}_ARS" if currency == "ARS" else f"{subject}_{currency}"

        end = m.end()
        tail = text[m.start(): m.start() + 80]
        cut = re.search(r"[.;\n]", tail[len(word):])
        if cut:
            tail = tail[: len(word) + cut.start()]

        claims.append(NumericClaim(
            value=value,
            subject=subject,
            unit=unit,
            source=source,
            raw_text=tail.strip(),
        ))

    # Deduplicate by (source, value, subject, unit) — sometimes the
    # same number appears multiple times in a sentence ("5 muertos y
    # otras 5 personas") and we only want one row.
    seen = set()
    deduped: list[NumericClaim] = []
    for c in claims:
        key = (c.source, c.value, c.subject, c.unit, c.raw_text[:40])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(c)

    return deduped


def find_contradictions(articles: Iterable[dict]) -> list[Contradiction]:
    """Group claims by (subject, unit) and return contradictions where
    distinct sources report different values.

    Each article is expected to be a dict with keys:
        source: str (source name or ID)
        summary: str (article body)
        title: str (article headline — also scanned)

    Articles with `source` missing/None are scanned but their entries
    are tagged with source="unknown" so a missing source won't crash
    the analysis.

    Confidence is computed as:
        0.7 * (n_distinct_sources / max_distinct_sources) + 0.3 * span_factor
    where span_factor = min(1.0, |max - min| / max(1, min))
    so multi-source deltas with bigger gaps score higher.
    """
    articles = list(articles)

    # Collect claims across articles
    all_claims: list[NumericClaim] = []
    for art in articles:
        source = (art.get("source") or "unknown") if isinstance(art, dict) else "unknown"
        summary = (art.get("summary") or "") if isinstance(art, dict) else ""
        title = (art.get("title") or "") if isinstance(art, dict) else ""
        text = f"{title}. {summary}".strip()
        if text:
            all_claims.extend(extract_numeric_claims(text, source=source))

    # Group by (subject, unit)
    groups: dict[tuple[str, str | None], list[NumericClaim]] = {}
    for c in all_claims:
        groups.setdefault((c.subject, c.unit), []).append(c)

    contradictions: list[Contradiction] = []
    for (subject, unit), claims in groups.items():
        distinct_values = {c.value for c in claims}
        if len(distinct_values) <= 1:
            # Everyone agrees — no contradiction
            continue

        distinct_sources = {c.source for c in claims if c.source and c.source != "unknown"}

        # Build entries: dedupe by (source, value) so we don't list
        # the same fact three times if it appears in two articles
        # from the same source.
        entries_seen = set()
        entries = []
        for c in claims:
            key = (c.source, c.value)
            if key in entries_seen:
                continue
            entries_seen.add(key)
            entries.append({
                "source": c.source,
                "value": c.value,
                "raw_text": c.raw_text,
            })

        # Confidence: prefer multi-source + large delta
        n_sources = len(distinct_sources)
        span = max(distinct_values) - min(distinct_values)
        ref = max(1.0, min(distinct_values))
        span_factor = min(1.0, span / ref)
        source_factor = min(1.0, n_sources / 2.0)
        confidence = round(0.7 * source_factor + 0.3 * span_factor, 3)

        contradictions.append(Contradiction(
            subject=subject,
            unit=unit,
            entries=entries,
            confidence=confidence,
        ))

    # Highest-confidence first, then by subject
    contradictions.sort(key=lambda c: (-c.confidence, c.subject))
    return contradictions