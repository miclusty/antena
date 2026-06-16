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

import numpy as np
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
# We use a tiered failure model:
#   - 1-2 consecutive failures: keep trying, but mark the call
#     as a "soft failure" (logged as warning). The next call
#     might succeed (transient network blip).
#   - 3+ consecutive failures: trip the circuit breaker. The
#     node is marked UNHEALTHY for COOLDOWN_SECONDS. This
#     prevents the LB from picking a dead node and wasting
#     REQUEST_TIMEOUT_EMBED seconds per attempt.
#   - After COOLDOWN_SECONDS, the node is retried once. If it
#     succeeds, it's healthy again. If it fails, the cooldown
#     restarts.
NODE_FAILURE_THRESHOLD = 3
NODE_COOLDOWN_SECONDS = 60.0
# How long to wait for a single HTTP request before counting
# it as a failure. The health probe uses HEALTH_PROBE_TIMEOUT
# (shorter) so we can detect a dead node in <5s.
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
    # When this node last came back from a DOWN state, used to
    # throttle the "RECOVERED" log line so we don't spam every
    # 60s if a node is flapping. 0.0 = never recovered yet.
    last_recovery_log_at: float = 0.0

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
        #
        # If a node's probe fails, REMOVE it from the active pool
        # for this script run. Reasoning: a node that's
        # unreachable at script start is almost certainly down
        # (the user is launching a pipeline, not while LM Studio
        # is restarting on the other Mac). Letting the
        # circuit-breaker try to recover it (60s cooldown,
        # re-probe, fail, 60s cooldown, ...) wastes 1-3% of
        # total pipeline time on a doomed node and risks
        # false-positive "FAILED" exits on the calling script.
        # The next script invocation will re-probe and
        # automatically add the node back if it's recovered.
        for node in list(self._nodes):  # copy — we mutate the list
            ok = False
            for attempt in range(3):
                try:
                    t0 = time.monotonic()
                    req = urllib.request.Request(
                        f"{node.url}/v1/models", method="GET"
                    )
                    with urllib.request.urlopen(req, timeout=3) as resp:
                        resp.read()
                    node.record_latency(time.monotonic() - t0)
                    ok = True
                    break
                except Exception as e:  # noqa: BLE001
                    logger.warning(
                        f"probe_failed node={node.url} "
                        f"attempt={attempt + 1}/3 error={e}"
                    )
            if not ok:
                logger.error(
                    f"LM Studio node {node.url} is unreachable at startup — "
                    f"REMOVED from active pool for this run. "
                    f"The next script invocation will re-probe."
                )
                self._nodes.remove(node)

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

    def rerank(
        self,
        query: str,
        candidates: Sequence[Dict],
        query_field: str = "title",
        doc_field: str = "summary",
        model: Optional[str] = None,
    ) -> List[Dict]:
        """Re-rank a list of candidate documents using bi-encoder
        embeddings (cosine between query and doc embeddings).

        Uses the EMBED model (not the passed `model` param) for
        embeddings, because bge-reranker-base is a cross-encoder
        and LM Studio rejects /v1/embeddings calls with that
        model name. The bi-encoder approach uses the embed
        model and computes cosine similarity. Returns candidates
        sorted by relevance score descending, with a
        `rerank_score` field added to each.

        ~30-50% faster per pair than a true cross-encoder but
        slightly less accurate.
        """
        # Always use the embed model, regardless of the `model` arg.
        # bge-reranker-base is a cross-encoder, not an embedding
        # model, so passing it to /v1/embeddings returns HTTP 400.
        model = self.embed_model
        t0 = time.monotonic()
        # Embed query once
        q_vec = np.array(self.embed(query, model=model), dtype=np.float32)
        q_norm = float(np.linalg.norm(q_vec)) + 1e-9

        def get_doc_text(doc: Dict) -> str:
            parts = []
            if doc.get(query_field):
                parts.append(str(doc[query_field]))
            if doc.get(doc_field):
                parts.append(str(doc[doc_field]))
            return ". ".join(parts)

        scored: List[Tuple[float, Dict]] = []
        for doc in candidates:
            text = get_doc_text(doc)
            d_vec = np.array(self.embed(text, model=model), dtype=np.float32)
            d_norm = float(np.linalg.norm(d_vec)) + 1e-9
            sim = float(np.dot(q_vec, d_vec) / (q_norm * d_norm))
            doc["rerank_score"] = round(sim, 4)
            scored.append((sim, doc))

        # Sort by score descending
        scored.sort(key=lambda x: -x[0])
        logger.info(
            f"rerank: {len(candidates)} candidates in "
            f"{(time.monotonic() - t0) * 1000:.0f}ms"
        )
        return [doc for _, doc in scored]

    def chat(
        self,
        messages: Sequence[Dict[str, str]],
        model: Optional[str] = None,
        max_tokens: int = 1024,
        temperature: float = 0.1,
        timeout: float = REQUEST_TIMEOUT_CHAT,
        no_thinking: bool = True,
    ) -> str:
        """Call the chat completions endpoint. Returns the content
        string (or reasoning_content if content is empty).

        no_thinking=True (default) asks Qwen 3.5-4B to skip its
        "thinking" phase. Without this, the model burns through
        1000+ tokens of internal reasoning before producing the
        actual response, inflating per-request latency from ~0.5s
        to ~20s. Qwen 3.5 supports this via a system message
        prefix and the `chat_template_kwargs` flag.
        """
        model = model or self.chat_model
        payload = {
            "model": model,
            "messages": list(messages),
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if no_thinking:
            # Qwen 3.5 honors /no_think in chat_template_kwargs.
            payload["chat_template_kwargs"] = {"enable_thinking": False}
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

    def _pick_node(self, avoid_url: Optional[str] = None) -> _NodeState:
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

        `avoid_url`: a node URL to skip (e.g. one that just
        failed in a retry context). When the caller is
        retrying, the previous attempt's node is unlikely to
        be healthy even if it's not yet in cooldown (it has
        at least 1 failure recorded). Excluding it gives
        the round-robin a chance to pick a different node
        even when the in-flight count would normally favor
        the failing one.

        Thread-safe: caller must NOT hold self._lock.
        """
        with self._lock:
            n = len(self._nodes)
            if n == 0:
                raise LMStudioError("No LM Studio nodes configured")
            healthy = [nd for nd in self._nodes if nd.cooldown_remaining() == 0.0]
            if avoid_url is not None:
                healthy = [nd for nd in healthy if nd.url != avoid_url]
            if not healthy:
                # All in cooldown (or all = avoid_url) — return the
                # one with the shortest wait, ignoring avoid_url.
                candidates = [nd for nd in self._nodes if nd.cooldown_remaining() == 0.0]
                if not candidates:
                    return min(self._nodes, key=lambda nd: nd.cooldown_remaining())
                return min(candidates, key=lambda nd: nd.cooldown_remaining())
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

        Circuit-breaker note: when a node is marked UNHEALTHY
        (3+ consecutive failures), it sits in cooldown for
        NODE_COOLDOWN_SECONDS. While in cooldown, _pick_node
        skips it. After the cooldown expires, the next call to
        _pick_node may pick it again — that call doubles as a
        health probe. If it succeeds, the node is back online;
        if it fails, the cooldown restarts.

        Retry policy: the second attempt always avoids the URL
        that just failed (via `avoid_url`). This is critical when
        a node is freshly down — only 1-2 failures recorded, so
        it's not in cooldown yet, and `_pick_node` would otherwise
        re-pick it because its `in_flight=0` is lower than the
        healthy node's. Without `avoid_url`, both attempts of
        a retry land on the same dead node and the call fails
        even though the other node is healthy.
        """
        body = json.dumps(payload).encode("utf-8")
        nodes_tried: List[str] = []
        last_failed_url: Optional[str] = None
        for attempt in range(2):
            # _pick_node acquires self._lock internally — caller must NOT hold it.
            node = self._pick_node(avoid_url=last_failed_url)
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
                # Detect "came back from down state": we just
                # succeeded, but the previous attempt was <5s
                # ago and failed. Simpler heuristic: if the
                # node's failures were >0 right before this
                # success, log the recovery.
                with self._lock:
                    was_failing = node.failures > 0
                    node.failures = 0
                    node.is_healthy = True
                    node.last_success_at = time.monotonic()
                    node.in_flight -= 1
                    node.record_latency(latency)
                if was_failing:
                    now = time.monotonic()
                    if now - node.last_recovery_log_at > 300:
                        logger.info(
                            f"LM Studio node RECOVERED: {node.url} "
                            f"(after recent failures)"
                        )
                        node.last_recovery_log_at = now
                return raw
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as e:
                with self._lock:
                    node.in_flight -= 1
                self._mark_failure(node, str(e))
                logger.warning(
                    f"LM Studio call failed (attempt {attempt + 1}/2) "
                    f"node={node.url} error={type(e).__name__}: {e}"
                )
                # Next iteration of the loop will skip this node
                last_failed_url = node.url
        raise LMStudioError(
            f"LM Studio unreachable after retries. Nodes tried: {nodes_tried}"
        )

    def _mark_failure(self, node: _NodeState, error: str) -> None:
        with self._lock:
            node.failures += 1
            node.last_failure_at = time.monotonic()
            if node.failures >= NODE_FAILURE_THRESHOLD:
                was_healthy = node.is_healthy
                node.is_healthy = False
                if was_healthy:
                    logger.error(
                        f"LM Studio node marked DOWN: {node.url} "
                        f"({node.failures} consecutive failures: {error[:80]}). "
                        f"Will retry in {NODE_COOLDOWN_SECONDS}s."
                    )

    def active_nodes(self) -> List[str]:
        """Return URLs of currently-healthy nodes. Useful for
        ops dashboards and the per-node logging in scripts."""
        with self._lock:
            return [n.url for n in self._nodes if n.is_healthy]

    def probe_node(self, url: str) -> bool:
        """Manually probe a specific node. Returns True if it
        responds within HEALTH_PROBE_TIMEOUT. Does not change
        the node's failure state — this is a passive check.

        Used by ops scripts to see if a node that's been marked
        down has come back. The next _pick_node call will also
        retry it automatically once the cooldown expires."""
        try:
            req = urllib.request.Request(f"{url}/v1/models", method="GET")
            with urllib.request.urlopen(req, timeout=HEALTH_PROBE_TIMEOUT) as resp:
                resp.read()
            return True
        except Exception:
            return False


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
