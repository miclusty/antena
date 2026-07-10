"""Tests for bias_narrative service."""
import json
from unittest.mock import MagicMock

from core.bias_narrative import (
    BiasNarrativeService,
    NarrativeCache,
    build_prompt,
    parse_llm_response,
    heuristic_fallback,
)


def test_build_prompt_includes_sources_and_excerpts():
    """Prompt must include source names, bias scores, and excerpts."""
    prompt = build_prompt(
        cluster_id="c-1",
        source_biases=[("Clarín", -0.6), ("Página/12", 0.3), ("Télam", 0.0)],
        excerpts=[
            ("Clarín", "Title A", "Body excerpt A..."),
            ("Página/12", "Title B", "Body excerpt B..."),
        ],
    )
    assert "Clarín" in prompt
    assert "-0.6" in prompt
    assert "Body excerpt A" in prompt
    assert "JSON" in prompt


def test_parse_llm_response_valid_json():
    """Valid JSON response parses correctly."""
    raw = '{"narrative": "Test narrative.", "key_quotes": [{"source": "X", "quote": "Q"}]}'
    result = parse_llm_response(raw)
    assert result["narrative"] == "Test narrative."
    assert len(result["key_quotes"]) == 1


def test_parse_llm_response_invalid_json_falls_back():
    """Malformed JSON returns None (caller uses heuristic fallback)."""
    assert parse_llm_response("not json at all") is None
    assert parse_llm_response('{"incomplete": ') is None


def test_heuristic_fallback_uses_dominant_bias():
    """Heuristic returns a sentence with the dominant bias direction."""
    result = heuristic_fallback([("Clarín", -0.6), ("Clarín", -0.4), ("Télam", 0.0)])
    assert "Opositor" in result or "oposición" in result.lower()


def test_heuristic_fallback_empty():
    """Empty list returns sensible default."""
    assert "no determinado" in heuristic_fallback([])


def test_service_generates_with_mocked_llm():
    """Service uses injected LLM client (mocked)."""
    mock_llm = MagicMock()
    mock_llm.chat.return_value = '{"narrative": "Mocked narrative.", "key_quotes": []}'
    svc = BiasNarrativeService(llm_client=mock_llm)
    result = svc.generate_for_cluster(
        cluster_id="c-1",
        source_biases=[("X", 0.0)],
        excerpts=[("X", "Title", "Excerpt")],
    )
    assert result["narrative"] == "Mocked narrative."
    assert result["source"] == "llm"
    assert mock_llm.chat.called


def test_service_falls_back_on_llm_error():
    """When LLM throws, service returns heuristic narrative."""
    mock_llm = MagicMock()
    mock_llm.chat.side_effect = ConnectionError("LMStudio down")
    svc = BiasNarrativeService(llm_client=mock_llm, fallback_to_heuristic=True)
    result = svc.generate_for_cluster("c-1", [("X", 0.0)], [])
    assert "Sesgo" in result["narrative"] or "sesgo" in result["narrative"].lower()
    assert result["source"] == "heuristic"


def test_cache_returns_narrative_within_ttl():
    """Cache hit if narrative was generated recently."""
    cache = NarrativeCache(ttl_seconds=86400)
    cache.set("c-1", {"narrative": "cached", "key_quotes": []}, now=1000.0)
    result = cache.get("c-1", now=1000.0 + 60)  # 60 seconds later
    assert result is not None
    assert result["narrative"] == "cached"


def test_cache_returns_none_when_stale():
    """Cache miss if narrative is older than TTL."""
    cache = NarrativeCache(ttl_seconds=86400)
    cache.set("c-1", {"narrative": "old", "key_quotes": []}, now=1000.0)
    result = cache.get("c-1", now=1000.0 + 86400 + 1)
    assert result is None


def test_cache_hit_avoids_llm_call():
    """When cache hits, LLM is NOT called."""
    mock_llm = MagicMock()
    mock_llm.chat.return_value = '{"narrative": "X", "key_quotes": []}'
    cache = NarrativeCache(ttl_seconds=86400)
    cache.set("c-1", {"narrative": "cached", "key_quotes": []}, now=1000.0)
    svc = BiasNarrativeService(llm_client=mock_llm, cache=cache)
    result = svc.generate_for_cluster("c-1", [], [], now=1001.0)
    assert result["narrative"] == "cached"
    assert result["source"] == "cache"
    assert not mock_llm.chat.called