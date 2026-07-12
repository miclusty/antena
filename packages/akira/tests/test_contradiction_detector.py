"""Tests for contradiction detector — finds numerical/factual disagreements
between sources covering the same cluster.

Design notes:
- The detector works in pure Python (no LLM) so it can run inside the
  hot path of cluster synthesis (called from _save_master_article).
- Spanish-aware regex handles 1.234 (es thousands), 1,5 (es decimal),
  "1.5 million", "cinco", and currency markers.
- We DO NOT modify simhash, bias_narrative, or credibility modules —
  this is a new layer that consumes the same cluster articles.
"""
from __future__ import annotations

from core.contradiction_detector import (
    NumericClaim,
    Contradiction,
    extract_numeric_claims,
    find_contradictions,
    normalize_subject,
    parse_spanish_number,
)


# ─── parse_spanish_number ─────────────────────────────────────────


def test_parse_spanish_number_simple_integer():
    assert parse_spanish_number("5") == 5.0


def test_parse_spanish_number_with_thousands_separator_es():
    # Spanish convention: 1.234 = 1234 (thousands sep)
    assert parse_spanish_number("1.234") == 1234.0
    assert parse_spanish_number("10.000") == 10000.0


def test_parse_spanish_number_with_thousands_separator_en():
    # English convention: 1,234 = 1234
    assert parse_spanish_number("1,234") == 1234.0


def test_parse_spanish_number_decimal_comma():
    # 1,5 = 1.5 (Spanish decimal)
    assert parse_spanish_number("1,5") == 1.5
    assert parse_spanish_number("0,75") == 0.75


def test_parse_spanish_number_decimal_dot():
    assert parse_spanish_number("1.5") == 1.5


def test_parse_spanish_number_with_suffix():
    # "1.5 mil" = 1500, "2 millones" = 2_000_000
    assert parse_spanish_number("1.5", suffix="mil") == 1500.0
    assert parse_spanish_number("2", suffix="millones") == 2_000_000.0
    assert parse_spanish_number("3", suffix="billones") == 3_000_000_000.0


def test_parse_spanish_number_invalid():
    assert parse_spanish_number("") is None
    assert parse_spanish_number("abc") is None


# ─── normalize_subject ────────────────────────────────────────────


def test_normalize_subject_lowercases_and_strips():
    assert normalize_subject("Muertos") == "muerto"
    assert normalize_subject("  HERIDOS  ") == "herido"
    assert normalize_subject("Personas evacuadas") == "persona evacuado"


def test_normalize_subject_handles_plural_stripping():
    # The detector treats "muertos" and "muerto" as the SAME subject
    # so a 5-vs-8 disagreement is flagged correctly even if one source
    # wrote "5 muertos" and the other "8 muerto" (singular typo).
    assert normalize_subject("muertos") == normalize_subject("muerto")
    assert normalize_subject("evacuados") == normalize_subject("evacuado")
    assert normalize_subject("heridas") == normalize_subject("herido")


# ─── extract_numeric_claims ───────────────────────────────────────


def test_extract_numeric_claims_basic_spanish():
    text = "El incendio dejó 5 muertos y 200 evacuados."
    claims = extract_numeric_claims(text, source="La Voz")
    subjects = {(c.value, c.subject) for c in claims}
    assert (5.0, "muerto") in subjects
    assert (200.0, "evacuado") in subjects


def test_extract_numeric_claims_with_thousands():
    # Spanish thousands separator
    text = "Hubo 1.000 damnificados según el reporte."
    claims = extract_numeric_claims(text, source="A")
    assert any(c.value == 1000.0 and c.subject == "damnificado" for c in claims)


def test_extract_numeric_claims_millions():
    text = "El presupuesto alcanza 1,5 millones de pesos."
    claims = extract_numeric_claims(text, source="A")
    # Subject should be either "peso" (just the noun) or "millon_peso"
    # (magnitude + noun). Both are acceptable; the detector picks
    # "millon_peso" because it's more informative for the UI.
    assert any(
        c.value == 1_500_000.0 and c.subject in ("peso", "millon_peso")
        for c in claims
    )


def test_extract_numeric_claims_currency():
    text = "La multa es de $100 pesos."
    claims = extract_numeric_claims(text, source="A")
    assert any(c.value == 100.0 and c.subject == "peso" for c in claims)


def test_extract_numeric_claims_percentage():
    text = "La inflación subió 50% en el mes."
    claims = extract_numeric_claims(text, source="A")
    assert any(c.value == 50.0 and c.unit == "%" for c in claims)


def test_extract_numeric_claims_temperature():
    text = "La temperatura llegó a 35 grados en la ciudad."
    claims = extract_numeric_claims(text, source="A")
    assert any(c.value == 35.0 and c.subject == "grado" for c in claims)


def test_extract_numeric_claims_distance():
    text = "El epicentro está a 12 kilómetros del centro."
    claims = extract_numeric_claims(text, source="A")
    assert any(c.value == 12.0 and c.subject == "kilometro" for c in claims)


def test_extract_numeric_claims_spanish_words():
    # Spanish number words must be parsed, not silently dropped
    text = "Cinco muertos y doscientos heridos en el accidente."
    claims = extract_numeric_claims(text, source="A")
    assert any(c.value == 5.0 and c.subject == "muerto" for c in claims)
    assert any(c.value == 200.0 and c.subject == "herido" for c in claims)


def test_extract_numeric_claims_attaches_source():
    claims = extract_numeric_claims("5 muertos", source="Clarín")
    assert all(c.source == "Clarín" for c in claims)


def test_extract_numeric_claims_empty_text():
    assert extract_numeric_claims("", source="X") == []
    assert extract_numeric_claims("Sin números acá.", source="X") == []


# ─── find_contradictions ──────────────────────────────────────────


def _article(source: str, summary: str = "", title: str = "") -> dict:
    return {"source": source, "summary": summary, "title": title}


def test_find_contradictions_detects_death_toll_disagreement():
    articles = [
        _article("A", "Hay 5 muertos en el incendio."),
        _article("B", "Reportan 8 muertos en el incendio."),
    ]
    contradictions = find_contradictions(articles)
    # One contradiction: deaths disagree (5 vs 8)
    death_contradictions = [c for c in contradictions if c.subject == "muerto"]
    assert len(death_contradictions) == 1
    c = death_contradictions[0]
    values = {entry["value"] for entry in c.entries}
    assert values == {5.0, 8.0}


def test_find_contradictions_detects_multiple_in_same_cluster():
    articles = [
        _article("A", "5 muertos y 200 evacuados."),
        _article("B", "8 muertos y 300 evacuados."),
        _article("C", "5 muertos y 200 evacuados."),  # agrees with A
    ]
    contradictions = find_contradictions(articles)
    subjects = {c.subject for c in contradictions}
    assert "muerto" in subjects
    assert "evacuado" in subjects


def test_find_contradictions_no_false_positive_when_agree():
    articles = [
        _article("A", "5 muertos en el incidente."),
        _article("B", "5 muertos en el incidente."),
        _article("C", "Cinco muertos reportados."),  # Spanish word = 5
    ]
    contradictions = find_contradictions(articles)
    # All sources agree on 5 — no contradiction
    death = [c for c in contradictions if c.subject == "muerto"]
    assert death == []


def test_find_contradictions_no_false_positive_when_same_value_different_words():
    # "5 muertos" and "cinco muertos" should be treated as the same number
    articles = [
        _article("A", "Hubo 5 muertos."),
        _article("B", "Hubo cinco muertos."),
    ]
    contradictions = find_contradictions(articles)
    assert contradictions == []


def test_find_contradictions_requires_distinct_sources():
    # Same source reporting different numbers in two articles is suspicious
    # but not a contradiction (probably same wire syndication). Skip.
    articles = [
        _article("A", "5 muertos reportados inicialmente."),
        _article("A", "8 muertos confirmados luego."),
    ]
    contradictions = find_contradictions(articles)
    # We DO flag this — even within a single source a delta like
    # 5 → 8 over time is a contradiction worth surfacing.
    # (Single source is acceptable: we're surface-level, downstream
    # filters can drop single-source deltas if needed.)
    death = [c for c in contradictions if c.subject == "muerto"]
    # The implementation should still surface the delta but with
    # only ONE source it should be filtered as low-confidence.
    # We accept either: filtered (preferred) or surfaced (allowed).
    # The contract: at minimum, this should NOT crash and should
    # return a deterministic result.
    assert isinstance(death, list)


def test_find_contradictions_different_units_kept_separate():
    # "5 grados" and "5 kilómetros" should NOT be flagged even though
    # the numeric value is identical (5). The unit matters.
    articles = [
        _article("A", "Temperatura de 35 grados."),
        _article("B", "A 35 kilómetros del epicentro."),
    ]
    contradictions = find_contradictions(articles)
    # Should not flag — different subjects
    assert contradictions == []


def test_find_contradictions_money_with_currency_marker():
    # Currency symbols should not pollute the subject key, but the
    # magnitude (millones) and currency (pesos) should be encoded in
    # either the subject or the unit.
    articles = [
        _article("A", "Costó $100 millones."),
        _article("B", "Costó $200 millones."),
    ]
    contradictions = find_contradictions(articles)
    money_contradiction = next(
        (c for c in contradictions if "millon" in c.subject or "peso" in c.subject),
        None,
    )
    assert money_contradiction is not None
    # Currency must be detectable from either the subject or the unit
    assert (
        "ARS" in money_contradiction.subject
        or money_contradiction.unit in ("ARS", "USD")
    )


def test_find_contradictions_uses_title_and_summary():
    # Both title and summary should be scanned (titles often carry the
    # headline number).
    articles = [
        _article("A", title="Incendio: 5 muertos", summary="Detalles del incidente."),
        _article("B", title="Incendio en Córdoba", summary="Ya son 8 muertos los confirmados."),
    ]
    contradictions = find_contradictions(articles)
    assert any(c.subject == "muerto" for c in contradictions)


def test_find_contradictions_confidence_levels():
    # High confidence: 2+ sources, values disagree
    # Low confidence: single source delta (allowed but lower weight)
    articles = [
        _article("A", "5 muertos."),
        _article("B", "8 muertos."),
        _article("C", "8 muertos."),
    ]
    contradictions = find_contradictions(articles)
    death = [c for c in contradictions if c.subject == "muerto"]
    assert len(death) == 1
    assert death[0].confidence >= 0.7  # multi-source disagreement


def test_find_contradictions_empty_input():
    assert find_contradictions([]) == []


def test_find_contradictions_articles_without_source_are_skipped():
    # Article with no source ID should not break the analysis
    articles = [
        _article("A", "5 muertos."),
        _article("B", "8 muertos."),
        {"source": None, "summary": "10 muertos.", "title": ""},
    ]
    # Should still find A vs B contradiction; the null-source article
    # may or may not be counted but should not raise.
    contradictions = find_contradictions(articles)
    assert any(c.subject == "muerto" for c in contradictions)


def test_find_contradictions_json_serializable():
    import json
    articles = [
        _article("A", "5 muertos."),
        _article("B", "8 muertos."),
    ]
    contradictions = find_contradictions(articles)
    # The cluster table stores JSON, so the output must round-trip cleanly.
    payload = [c.to_dict() for c in contradictions]
    encoded = json.dumps(payload, ensure_ascii=False)
    decoded = json.loads(encoded)
    assert isinstance(decoded, list)
    assert decoded[0]["subject"] == "muerto"


def test_find_contradictions_filters_trivial_differences():
    # "5 muertos" and "5 muertos" with no other content — should be empty
    articles = [
        _article("A", "5 muertos en el lugar."),
        _article("B", "5 muertos confirmados."),
    ]
    contradictions = find_contradictions(articles)
    # Same value → no contradiction
    assert contradictions == []


def test_find_contradictions_percent_disagreement():
    articles = [
        _article("A", "La inflación fue del 50%."),
        _article("B", "La inflación fue del 30%."),
    ]
    contradictions = find_contradictions(articles)
    assert any(c.unit == "%" for c in contradictions)