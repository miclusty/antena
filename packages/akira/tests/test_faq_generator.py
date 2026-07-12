"""Tests for FAQGenerator — extracts reader-style Q&A from cluster
articles. Mirrors the bias_narrative test pattern.

TDD: written before the implementation. Run with:
    cd packages/akira && source .venv/bin/activate && python -m pytest tests/test_faq_generator.py -v
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock

from core.faq_generator import (
    FAQGenerator,
    FAQCache,
    FAQ,
    build_prompt,
    parse_llm_response,
    heuristic_fallback,
    extract_heuristic_questions,
    _validate_faq,
)


# ─── Prompt builder ─────────────────────────────────────────────


def test_build_prompt_includes_articles_and_sources():
    prompt = build_prompt(
        cluster_id="c-1",
        articles=[
            {"title": "Reforma previsional 2026", "summary": "Se votó hoy.", "source": "Clarín"},
            {"title": "Jubilados: nuevos topes", "summary": "Cambios desde julio.", "source": "Página/12"},
        ],
    )
    assert "Reforma previsional 2026" in prompt
    assert "Se votó hoy." in prompt
    assert "Clarín" in prompt
    assert "JSON" in prompt


def test_build_prompt_truncates_long_bodies():
    long_body = "x" * 5000
    prompt = build_prompt(
        cluster_id="c-1",
        articles=[{"title": "T", "summary": long_body, "source": "X"}],
    )
    # Body excerpt should be truncated to ~200 chars
    # Count x's — should be bounded
    assert prompt.count("x") <= 250


# ─── LLM response parser ────────────────────────────────────────


def test_parse_llm_response_valid_list():
    raw = json.dumps([
        {"question": "¿Cuándo se votó?", "answer": "Hoy.", "source_count": 4},
        {"question": "¿Quiénes se oponen?", "answer": "La oposición.", "source_count": 3},
    ])
    result = parse_llm_response(raw)
    assert result is not None
    assert len(result) == 2
    assert result[0]["question"].startswith("¿Cuándo")


def test_parse_llm_response_with_markdown_fences():
    raw = '```json\n[{"question": "Q1", "answer": "A1", "source_count": 2}]\n```'
    result = parse_llm_response(raw)
    assert result is not None
    assert result[0]["question"] == "Q1"


def test_parse_llm_response_invalid_returns_none():
    assert parse_llm_response("not json") is None
    assert parse_llm_response('{"single": "object"}') is None  # not a list
    assert parse_llm_response('[]') == []  # empty list is valid


def test_parse_llm_response_filters_invalid_items():
    raw = json.dumps([
        {"question": "", "answer": "bad"},  # empty question
        {"question": "OK?", "answer": "Yes.", "source_count": 2},
        {"no question field": True},  # missing keys
    ])
    result = parse_llm_response(raw)
    assert result is not None
    assert len(result) == 1
    assert result[0]["question"] == "OK?"


# ─── FAQ validator ──────────────────────────────────────────────


def test_validate_faq_accepts_well_formed():
    faq = {"question": "¿Qué pasó?", "answer": "Algo.", "source_count": 3}
    assert _validate_faq(faq) is True


def test_validate_faq_rejects_missing_fields():
    assert _validate_faq({"question": "Q"}) is False
    assert _validate_faq({"answer": "A"}) is False


def test_validate_faq_rejects_too_long_answer():
    faq = {"question": "Q", "answer": "x" * 1000, "source_count": 3}
    assert _validate_faq(faq) is False  # 1000 chars > 4 sentences likely


# ─── Heuristic fallback ─────────────────────────────────────────


def test_extract_heuristic_questions_from_titles():
    titles = [
        "Cuándo se vota la reforma previsional",
        "Quiénes se oponen al cambio",
        "Qué dice el proyecto oficial",
    ]
    qs = extract_heuristic_questions(titles)
    assert len(qs) >= 1
    # All generated questions end with "?"
    assert all(q.endswith("?") for q in qs)


def test_extract_heuristic_questions_handles_spanish_accents():
    titles = ["¿Cuándo se vota?", "¿Quiénes se oponen?"]
    qs = extract_heuristic_questions(titles)
    # Already in question form — still extract something useful
    assert isinstance(qs, list)


def test_extract_heuristic_questions_empty():
    assert extract_heuristic_questions([]) == []
    assert extract_heuristic_questions(["Sin palabras clave"]) == []


def test_heuristic_fallback_returns_faq_list():
    articles = [
        {"title": "Cuándo se vota la reforma", "summary": "s", "source": "X"},
    ]
    faqs = heuristic_fallback(articles)
    assert isinstance(faqs, list)
    if faqs:
        assert "question" in faqs[0]
        assert "answer" in faqs[0]
        assert "source_count" in faqs[0]


# ─── FAQCache ───────────────────────────────────────────────────


def test_cache_hit_within_ttl():
    cache = FAQCache(ttl_seconds=86400)
    payload = [{"question": "Q", "answer": "A", "source_count": 2}]
    cache.set("c-1", payload, now=1000.0)
    result = cache.get("c-1", now=1000.0 + 60)
    assert result is not None
    assert result[0]["question"] == "Q"


def test_cache_stale_returns_none():
    cache = FAQCache(ttl_seconds=86400)
    cache.set("c-1", [{"question": "Q", "answer": "A", "source_count": 2}], now=1000.0)
    result = cache.get("c-1", now=1000.0 + 86400 + 1)
    assert result is None


# ─── FAQGenerator service ───────────────────────────────────────


def test_service_generates_with_mocked_llm():
    """Service uses injected LLM client (mocked)."""
    mock_llm = MagicMock()
    mock_llm.chat.return_value = json.dumps([
        {"question": "¿Qué pasó?", "answer": "Algo.", "source_count": 4},
    ])
    svc = FAQGenerator(llm_client=mock_llm)
    result = svc.generate_for_cluster(
        cluster_id="c-1",
        articles=[{"title": "T", "summary": "S", "source": "X"}],
    )
    assert result["faqs"][0]["question"] == "¿Qué pasó?"
    assert result["source"] == "llm"
    assert mock_llm.chat.called


def test_service_falls_back_to_heuristic_on_llm_error():
    mock_llm = MagicMock()
    mock_llm.chat.side_effect = ConnectionError("LMStudio down")
    svc = FAQGenerator(llm_client=mock_llm, fallback_to_heuristic=True)
    result = svc.generate_for_cluster(
        cluster_id="c-1",
        articles=[
            {"title": "Cuándo se vota la reforma", "summary": "Detalle.", "source": "X"},
        ],
    )
    assert result["source"] == "heuristic"
    assert isinstance(result["faqs"], list)


def test_service_returns_empty_when_no_articles():
    mock_llm = MagicMock()
    svc = FAQGenerator(llm_client=mock_llm)
    result = svc.generate_for_cluster(cluster_id="c-1", articles=[])
    assert result["faqs"] == []
    assert result["source"] == "empty"
    assert not mock_llm.chat.called  # no LLM call needed


def test_service_uses_cache_when_available():
    mock_llm = MagicMock()
    mock_llm.chat.return_value = '[{"question": "X", "answer": "Y", "source_count": 1}]'
    cache = FAQCache(ttl_seconds=86400)
    cache.set("c-1", [{"question": "Cached Q", "answer": "Cached A", "source_count": 2}], now=1000.0)
    svc = FAQGenerator(llm_client=mock_llm, cache=cache)
    result = svc.generate_for_cluster(
        cluster_id="c-1",
        articles=[{"title": "T", "summary": "S", "source": "X"}],
        now=1001.0,
    )
    assert result["faqs"][0]["question"] == "Cached Q"
    assert result["source"] == "cache"
    assert not mock_llm.chat.called


def test_service_handles_malformed_llm_response():
    mock_llm = MagicMock()
    mock_llm.chat.return_value = "totally not json at all"
    svc = FAQGenerator(llm_client=mock_llm, fallback_to_heuristic=True)
    result = svc.generate_for_cluster(
        cluster_id="c-1",
        articles=[{"title": "Cuándo se vota la reforma", "summary": "Detalle.", "source": "X"}],
    )
    # Malformed → heuristic fallback
    assert result["source"] == "heuristic"
    assert isinstance(result["faqs"], list)


def test_service_limits_to_max_faqs():
    mock_llm = MagicMock()
    # Return 10 FAQs but service should cap at 5
    mock_llm.chat.return_value = json.dumps([
        {"question": f"Q{i}?", "answer": f"A{i}.", "source_count": 1} for i in range(10)
    ])
    svc = FAQGenerator(llm_client=mock_llm, max_faqs=5)
    result = svc.generate_for_cluster(
        cluster_id="c-1",
        articles=[{"title": "T", "summary": "S", "source": "X"}],
    )
    assert len(result["faqs"]) <= 5