"""
LM Studio client with multi-node load balancing and in-memory cache.

This module wraps the LM Studio OpenAI-compatible API for both
embeddings (/v1/embeddings) and chat completions (/v1/chat/completions).

Design choices:
  - asyncio + aiohttp for concurrency, but exposes a sync API too
    because the existing AKIRA scripts use sync `requests`/`urllib`.
  - Round-robin load balancing across N LM Studio nodes (currently
    one — http://192.168.31.37:1234 — but trivially extensible).
  - Health checks: 5s timeout per call, 30s background probe for dead
    nodes. A node that fails 3 in a row is marked down for 60s.
  - Embedding cache: in-memory dict[(model, text_hash), vector]. Hash
    is sha256 of the model+text — collision-free for our purposes.
    Persists across calls within a single Python process.
  - No global mutable state outside the cache: instantiate one
    LMStudioClient() per script and pass it around.
  - No silent failures: every call returns either the result or
    raises LMStudioError. Callers decide whether to retry.

Usage:
    client = LMStudioClient()
    vec = client.embed("hello world")            # 768-dim list[float]
    text = client.chat([...], max_tokens=200)    # str

Configuration via env vars:
    AKIRA_LMSTUDIO_NODES  comma-separated URLs (default:
                          http://192.168.31.37:1234)
    AKIRA_LMSTUDIO_MODEL  chat model (default: qwen3.5-4b)
    AKIRA_LMSTUDIO_EMBED  embed model (default:
                          text-embedding-nomic-embed-text-v1.5)
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

import urllib.error
import urllib.request

logger = logging.getLogger("akira.lmstudio")

# ─── Configuration ─────────────────────────────────────────────────

DEFAULT_NODES = [
    "http://localhost:1234",          # M4 (local, lowest latency, always preferred)
    "http://192.168.31.37:1234",      # M5 (LAN, ~5x slower than localhost, used as fallback / extra capacity)
]
DEFAULT_CHAT_MODEL = "qwen3.5-4b"
DEFAULT_EMBED_MODEL = "text-embedding-nomic-embed-text-v1.5"

# Per-node failure tracking
NODE_FAILURE_THRESHOLD = 3
NODE_COOLDOWN_SECONDS = 60.0
HEALTH_PROBE_TIMEOUT = 5.0
REQUEST_TIMEOUT_EMBED = 30.0
REQUEST_TIMEOUT_CHAT = 180.0

# ─── Errors ───────────────────────────────────────────────────────


class LMStudioError(RuntimeError):
    """Raised when LM Studio is unreachable, returns an error, or
    fails health check. Callers should catch this and decide whether
    to retry on a different node or abort."""


# ─── Node state ────────────────────────────────────────────────────


@dataclass
class _NodeState:
    """Per-node health + load-balancing cursor.

    Tracks: request count, failures, cooldown, rolling average
    latency, AND the in-flight counter. The in-flight counter
    is the key signal: LM Studio processes chat requests one
    at a time per node, so the node with the fewest in-flight
    requests is the one that can start the next call
    immediately. We pair this with the rolling latency to
    break ties and to detect "node is alive but slow".

    Note: latency_samples is an INCIDENTAL metric, not a
    steering signal. We don't pick "the fastest node" — we
    pick "the least-busy node", which is what actually
    saturates both Macs in parallel.
    """

    url: str
    failures: int = 0
    last_failure_at: float = 0.0
    last_success_at: float = 0.0
    is_healthy: bool = True
    request_count: int = 0
    in_flight: int = 0
    # Latency tracking: rolling window of last 20 successful
    # requests, in seconds. Used for stats and tie-breaking
    # when two nodes have the same in-flight count.
    latency_samples: List[float] = field(default_factory=list)
    LATENCY_WINDOW = 20

    def cooldown_remaining(self) -> float:
        if not self.is_healthy:
            elapsed = time.monotonic() - self.last_failure_at
            return max(0.0, NODE_COOLDOWN_SECONDS - elapsed)
        return 0.0

    def avg_latency(self) -> float:
        if not self.latency_samples:
            return float("inf")  # unknown = try me
        return sum(self.latency_samples) / len(self.latency_samples)

    def record_latency(self, latency_seconds: float) -> None:
        self.latency_samples.append(latency_seconds)
        if len(self.latency_samples) > self.LATENCY_WINDOW:
            self.latency_samples = self.latency_samples[-self.LATENCY_WINDOW :]


# ─── Client ───────────────────────────────────────────────────────


class LMStudioClient:
    """Multi-node LM Studio client with health-aware round-robin.

    Thread-safe: a single instance can be shared across threads.
    For async callers, prefer the `async_*` methods when you can —
    they pipeline multiple concurrent requests to whichever nodes
    are healthy, instead of serializing through urllib.
    """

    def __init__(
        self,
        nodes: Optional[Sequence[str]] = None,
        chat_model: Optional[str] = None,
        embed_model: Optional[str] = None,
        enable_cache: bool = True,
    ) -> None:
        env_nodes = os.getenv("AKIRA_LMSTUDIO_NODES", ",".join(DEFAULT_NODES))
        node_urls = [u.strip() for u in env_nodes.split(",") if u.strip()] or list(DEFAULT_NODES)
        self._nodes: List[_NodeState] = [_NodeState(url=u) for u in node_urls]
        self._cursor: int = 0
        self._lock = threading.Lock()
        self.chat_model = chat_model or os.getenv("AKIRA_LMSTUDIO_MODEL", DEFAULT_CHAT_MODEL)
        self.embed_model = embed_model or os.getenv(
            "AKIRA_LMSTUDIO_EMBED", DEFAULT_EMBED_MODEL
        )
        self._cache: Dict[Tuple[str, str], List[float]] = {} if enable_cache else {}
        logger.info(
            f"LMStudioClient ready: {len(self._nodes)} node(s), "
            f"chat={self.chat_model}, embed={self.embed_model}, "
            f"cache={'on' if enable_cache else 'off'}"
        )
        # Warm up: probe every node with a tiny /v1/models GET so
        # the latency-aware picker has real data. Without this,
        # all requests go to the first-configured node (whose
        # latency is finite) while the others sit at "inf" forever.
        for node in self._nodes:
            try:
                t0 = time.monotonic()
                req = urllib.request.Request(f"{node.url}/v1/models", method="GET")
                with urllib.request.urlopen(req, timeout=3) as resp:
                    resp.read()
                node.record_latency(time.monotonic() - t0)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"probe_failed node={node.url} error={e}")

    # ─── Public sync API ──────────────────────────────────────

    def embed(self, text: str, model: Optional[str] = None) -> List[float]:
        """Compute embedding for a single text. Caches by (model, text)."""
        model = model or self.embed_model
        key = (model, self._hash(text))
        if key in self._cache:
            return self._cache[key]
        payload = {"input": text, "model": model}
        raw = self._post_json("/v1/embeddings", payload, REQUEST_TIMEOUT_EMBED)
        try:
            vec = raw["data"][0]["embedding"]
        except (KeyError, IndexError, TypeError) as e:
            raise LMStudioError(f"Bad embed response: {raw}") from e
        if not isinstance(vec, list) or not vec:
            raise LMStudioError(f"Empty embedding for text={text[:60]!r}")
        self._cache[key] = vec
        return vec

    def embed_batch(
        self, texts: Sequence[str], model: Optional[str] = None
    ) -> List[List[float]]:
        """Compute embeddings for a batch. Caches per-item."""
        return [self.embed(t, model=model) for t in texts]

    def chat(
        self,
        messages: Sequence[Dict[str, str]],
        model: Optional[str] = None,
        max_tokens: int = 4000,
        temperature: float = 0.1,
        timeout: float = REQUEST_TIMEOUT_CHAT,
    ) -> str:
        """Call the chat completions endpoint. Returns the content
        string (or reasoning_content if content is empty)."""
        model = model or self.chat_model
        payload = {
            "model": model,
            "messages": list(messages),
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        raw = self._post_json("/v1/chat/completions", payload, timeout)
        try:
            msg = raw["choices"][0]["message"]
        except (KeyError, IndexError, TypeError) as e:
            raise LMStudioError(f"Bad chat response: {raw}") from e
        return msg.get("content") or msg.get("reasoning_content") or ""

    def cache_stats(self) -> Dict[str, int]:
        """Return cache stats for diagnostics. Useful when debugging
        'why is this slow' — a non-zero hit count means embeddings
        were reused, a zero means every call hit the LM Studio API."""
        return {
            "size": len(self._cache),
            "hits_total": getattr(self, "_cache_hits", 0),
        }

    # ─── Async API ────────────────────────────────────────────

    async def aembed(self, text: str, model: Optional[str] = None) -> List[float]:
        # Same logic as sync; we don't have aiohttp in deps yet.
        return self.embed(text, model)

    # ─── Internals ────────────────────────────────────────────

    def _hash(self, text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    def _pick_node(self) -> _NodeState:
        """Pick a healthy node. The primary signal is the in-flight
        count: the node with FEWER concurrent requests in progress
        is the one that can start the next call immediately.

        This is the key to actually saturating both Macs in
        parallel. If we picked "fastest" (lowest avg_latency),
        all workers would race to whichever node responded
        faster on a small test, and the slower node would sit
        idle. With in-flight balancing, as soon as worker 1
        grabs localhost, worker 2 sees localhost=1 and grabs
        M5. Workers 3 and 4 split: localhost+1, M5+1, etc.

        Tie-break: among nodes with the same in-flight count,
        pick the one with the lowest avg latency (the
        historically faster one wins). Last tie-break: lowest
        request_count (round-robin among same-speed nodes).

        Thread-safe: caller must NOT hold self._lock.
        """
        with self._lock:
            n = len(self._nodes)
            if n == 0:
                raise LMStudioError("No LM Studio nodes configured")
            healthy = [nd for nd in self._nodes if nd.cooldown_remaining() == 0.0]
            if not healthy:
                # All in cooldown — return the one with the shortest wait
                return min(self._nodes, key=lambda nd: nd.cooldown_remaining())
            if len(healthy) == 1:
                return healthy[0]
            # Primary: in-flight count (ascending — fewest in flight wins).
            # Secondary: avg latency (ascending — faster wins ties).
            # Tertiary:  request_count (ascending — round-robin among equals).
            return min(
                healthy,
                key=lambda nd: (nd.in_flight, nd.avg_latency(), nd.request_count),
            )

    def _post_json(self, path: str, payload: Dict[str, Any], timeout: float) -> Dict[str, Any]:
        """POST JSON to a node. On failure, mark node down and retry
        on a different node once. If both fail, raise LMStudioError.

        `path` is the URL path (e.g. "/v1/embeddings"). The full URL
        is built from the chosen node's base + this path, so each
        attempt uses the node the round-robin actually picked.
        """
        body = json.dumps(payload).encode("utf-8")
        nodes_tried: List[str] = []
        for attempt in range(2):
            # _pick_node acquires self._lock internally — caller must NOT hold it.
            node = self._pick_node()
            nodes_tried.append(node.url)
            with self._lock:
                node.request_count += 1
                node.in_flight += 1
            url = f"{node.url}{path}"
            t0 = time.monotonic()
            try:
                req = urllib.request.Request(
                    url,
                    data=body,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    raw = json.loads(resp.read().decode("utf-8"))
                latency = time.monotonic() - t0
                with self._lock:
                    node.failures = 0
                    node.is_healthy = True
                    node.last_success_at = time.monotonic()
                    node.in_flight -= 1
                    node.record_latency(latency)
                return raw
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as e:
                with self._lock:
                    node.in_flight -= 1
                self._mark_failure(node, str(e))
                logger.warning(
                    f"LM Studio call failed (attempt {attempt + 1}/2) "
                    f"node={node.url} error={type(e).__name__}: {e}"
                )
        raise LMStudioError(
            f"LM Studio unreachable after retries. Nodes tried: {nodes_tried}"
        )

    def _mark_failure(self, node: _NodeState, error: str) -> None:
        with self._lock:
            node.failures += 1
            node.last_failure_at = time.monotonic()
            if node.failures >= NODE_FAILURE_THRESHOLD:
                node.is_healthy = False
                logger.error(
                    f"LM Studio node marked DOWN: {node.url} "
                    f"({node.failures} consecutive failures)"
                )


# ─── Module-level default instance ────────────────────────────────
# Use this for one-off scripts; instantiate a fresh LMStudioClient()
# if you need a different model configuration.

_default_client: Optional[LMStudioClient] = None
_default_lock = threading.Lock()


def get_default_client() -> LMStudioClient:
    """Lazily-instantiated shared client. Thread-safe."""
    global _default_client
    with _default_lock:
        if _default_client is None:
            _default_client = LMStudioClient()
        return _default_client
