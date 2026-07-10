"""Bias narrative generation for clusters.

Uses LMStudio (qwen3.5-2b local) to generate a 2-3 sentence
explanation of cluster bias, citing representative sources.

Per user decision 2026-07-10: NO MiniMax fallback. If LMStudio is
down, fall back to heuristic narrative only.

Caching: 24h per cluster_id. Lighter than re-running LLM.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable

logger = logging.getLogger("akira.bias_narrative")


# Bias labels in Argentine Spanish
_BIAS_LABELS = {
    (-1.0, -0.5): "Opositor fuerte",
    (-0.5, -0.1): "Opositor moderado",
    (-0.1, 0.1): "Neutral",
    (0.1, 0.5): "Oficialista moderado",
    (0.5, 1.0): "Oficialista fuerte",
}


def _bias_label(score: float) -> str:
    for (lo, hi), label in _BIAS_LABELS.items():
        if lo <= score <= hi:
            return label
    return "Neutral"


def build_prompt(
    cluster_id: str,
    source_biases: list[tuple[str, float]],
    excerpts: list[tuple[str, str, str]],
) -> str:
    """Construct the LLM prompt for bias narrative generation."""
    src_lines = "\n".join(
        f"- {name}: sesgo {b:.2f} ({_bias_label(b)})"
        for name, b in source_biases
    )
    excerpt_lines = "\n".join(
        f"[{src}] {title}\n  {excerpt[:200]}"
        for src, title, excerpt in excerpts
    )
    return f"""Sos un analista de medios argentinos. Te paso un cluster de noticias con fuentes y excerpts.

Generá una explicación de 2-3 oraciones del sesgo editorial agregado del cluster. Citá fuentes representativas con su postura (incluí el nombre exacto). Si no hay sesgo claro, decilo.

Output estrictamente en JSON:
{{"narrative": "2-3 oraciones aquí", "key_quotes": [{{"source": "Nombre Exacto", "quote": "cita textual corta del excerpt"}}]}}

Cluster ID: {cluster_id}

Fuentes con sesgo:
{src_lines}

Excerpts representativos:
{excerpt_lines}

JSON:"""


def parse_llm_response(raw: str) -> dict[str, Any] | None:
    """Parse LLM JSON output. Returns None on malformed input."""
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            return None
        if "narrative" not in data or not isinstance(data["narrative"], str):
            return None
        if "key_quotes" in data and not isinstance(data["key_quotes"], list):
            data["key_quotes"] = []
        return data
    except (json.JSONDecodeError, ValueError):
        return None


def heuristic_fallback(source_biases: list[tuple[str, float]]) -> str:
    """Heuristic narrative when LLM fails or is unavailable."""
    if not source_biases:
        return "Sesgo editorial del cluster no determinado (sin fuentes)."
    avg = sum(b for _, b in source_biases) / len(source_biases)
    src_names = ", ".join(name for name, _ in source_biases[:3])
    return (
        f"Sesgo editorial dominante: {_bias_label(avg)} "
        f"(promedio {avg:.2f} sobre {len(source_biases)} fuentes: {src_names}). "
        f"Sin análisis LLM disponible — narrativa heurística."
    )


@dataclass
class NarrativeCache:
    """In-memory cache for bias narratives. 24h TTL."""
    ttl_seconds: int = 86400
    _store: dict[str, tuple[float, dict]] = field(default_factory=dict)

    def get(self, cluster_id: str, now: float | None = None) -> dict | None:
        entry = self._store.get(cluster_id)
        if not entry:
            return None
        stored_at, payload = entry
        if (now or time.time()) - stored_at > self.ttl_seconds:
            self._store.pop(cluster_id, None)
            return None
        return payload

    def set(self, cluster_id: str, payload: dict, now: float | None = None) -> None:
        self._store[cluster_id] = (now or time.time(), payload)


class BiasNarrativeService:
    """Orchestrates bias narrative generation with caching + fallback."""

    def __init__(
        self,
        llm_client: Any,
        cache: NarrativeCache | None = None,
        fallback_to_heuristic: bool = True,
    ):
        self.llm = llm_client
        self.cache = cache or NarrativeCache()
        self.fallback_to_heuristic = fallback_to_heuristic

    def generate_for_cluster(
        self,
        cluster_id: str,
        source_biases: list[tuple[str, float]],
        excerpts: list[tuple[str, str, str]],
        now: float | None = None,
    ) -> dict:
        """Returns {narrative, key_quotes, source: 'llm'|'heuristic'|'cache'}."""
        cached = self.cache.get(cluster_id, now=now)
        if cached:
            return {**cached, "source": "cache"}

        prompt = build_prompt(cluster_id, source_biases, excerpts)
        try:
            raw = self.llm.chat(prompt, max_tokens=300)
            parsed = parse_llm_response(raw)
            if parsed is None:
                raise ValueError("Malformed LLM response")
            self.cache.set(cluster_id, parsed, now=now)
            return {**parsed, "source": "llm"}
        except Exception as e:
            logger.warning(f"Bias narrative LLM failed for cluster {cluster_id}: {e}")
            if self.fallback_to_heuristic:
                fb = {
                    "narrative": heuristic_fallback(source_biases),
                    "key_quotes": [],
                }
                self.cache.set(cluster_id, fb, now=now)
                return {**fb, "source": "heuristic"}
            raise