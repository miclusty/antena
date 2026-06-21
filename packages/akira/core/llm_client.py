"""Unified LLM client for AKIRA synthesis and embeddings.

Routes chat + embed calls to one of two providers:
- LM Studio (local, default) — uses core.lmstudio.LMStudioClient multi-node
- MiniMax (cloud, when AKIRA_USE_MINIMAX=1) — uses urllib directly

Both providers expose the same .chat() / .embed() interface, so callers
(synthesis.py, rag.py, scripts) don't need provider-specific code.

The MiniMax API is OpenAI-compatible so we use the same payload format
(/v1/text/chatcompletion_v2 for chat, /v1/embeddings for embed).

Provider selection (in priority order):
1. Explicit `provider=` argument
2. `AKIRA_USE_MINIMAX=1` env var → "minimax"
3. Otherwise → "lmstudio"
"""
from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Sequence

from .lmstudio import LMStudioClient, LMStudioError

logger = logging.getLogger("akira.llm_client")


class LLMError(RuntimeError):
    """Raised when an LLM call fails. Callers should catch and decide
    whether to retry, fall back to the other provider, or abort."""


class LLMClient:
    """Single facade for LM Studio and MiniMax.

    Usage:
        client = LLMClient()                                  # LM Studio (default)
        client = LLMClient(provider="minimax", api_key="...")  # MiniMax

        text = client.chat([{"role": "user", "content": prompt}])
        vec = client.embed("some text")

    Both providers cache chat results keyed on (model, prompt_hash) when
    caching is available. LM Studio caches via the multi-node client;
    MiniMax caching is the caller's responsibility (or use LM Studio for
    repeated prompts).
    """

    def __init__(
        self,
        provider: Optional[str] = None,
        minimax_api_key: Optional[str] = None,
        minimax_api_base: Optional[str] = None,
        chat_model: Optional[str] = None,
        embed_model: Optional[str] = None,
    ):
        if provider is None:
            use_minimax_env = os.getenv("AKIRA_USE_MINIMAX", "").strip().lower()
            provider = "minimax" if use_minimax_env in ("1", "true", "yes") else "lmstudio"

        self.provider = provider

        if provider == "lmstudio":
            self._impl = LMStudioClient(
                chat_model=chat_model, embed_model=embed_model
            )
            self.chat_model = self._impl.chat_model
            self.embed_model = self._impl.embed_model
        elif provider == "minimax":
            self.api_key = minimax_api_key or os.getenv("MINIMAX_API_KEY", "")
            self.api_base = (
                minimax_api_base
                or os.getenv("MINIMAX_API_BASE", "https://api.minimax.io/v1")
            )
            self.chat_model = chat_model or os.getenv(
                "AKIRA_MINIMAX_CHAT_MODEL", "MiniMax-M2.7"
            )
            self.embed_model = embed_model or os.getenv(
                "AKIRA_MINIMAX_EMBED_MODEL", "text-embedding-3-small"
            )
            if not self.api_key:
                raise ValueError(
                    "minimax provider requires minimax_api_key "
                    "or MINIMAX_API_KEY env var"
                )
        else:
            raise ValueError(
                f"unknown LLM provider: {provider!r} (expected 'lmstudio' or 'minimax')"
            )

        logger.info(
            f"LLMClient ready: provider={self.provider} "
            f"chat={self.chat_model} embed={self.embed_model}"
        )

    def chat(
        self,
        messages: Sequence[Dict[str, str]],
        max_tokens: int = 2000,
        temperature: float = 0.1,
        timeout: float = 60.0,
    ) -> str:
        """Chat completion. Returns the model's response as a string.

        `messages` follows the OpenAI chat format:
            [{"role": "system"|"user"|"assistant", "content": "..."}]
        """
        if self.provider == "lmstudio":
            return self._impl.chat(
                messages, max_tokens=max_tokens, temperature=temperature
            )
        return self._chat_minimax(messages, max_tokens, temperature, timeout)

    def embed(self, text: str, model: Optional[str] = None) -> List[float]:
        """Compute embedding for a single text. Returns a list of floats.

        Provider-specific model can be overridden via `model=`.
        """
        if self.provider == "lmstudio":
            return self._impl.embed(text, model=model)
        return self._embed_minimax(text, model=model)

    # ─── MiniMax private methods ─────────────────────────────────────

    def _chat_minimax(
        self,
        messages: Sequence[Dict[str, str]],
        max_tokens: int,
        temperature: float,
        timeout: float,
    ) -> str:
        """POST to MiniMax /v1/text/chatcompletion_v2.

        Raises LLMError on network/HTTP/parse failure.
        """
        payload = {
            "model": self.chat_model,
            "messages": list(messages),
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        try:
            req = urllib.request.Request(
                f"{self.api_base}/text/chatcompletion_v2",
                data=json.dumps(payload).encode(),
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = json.loads(resp.read())
                content: str = raw["choices"][0]["message"].get("content", "")
                return content
        except (
            urllib.error.URLError,
            urllib.error.HTTPError,
            json.JSONDecodeError,
            KeyError,
            IndexError,
        ) as e:
            logger.error(f"minimax_chat_failed model={self.chat_model} error={e}")
            raise LLMError(f"minimax chat failed: {e}") from e

    def _embed_minimax(self, text: str, model: Optional[str] = None) -> List[float]:
        """POST to MiniMax /v1/embeddings (OpenAI-compatible).

        Raises LLMError on failure.
        """
        use_model = model or self.embed_model
        payload = {"input": text, "model": use_model}
        try:
            req = urllib.request.Request(
                f"{self.api_base}/embeddings",
                data=json.dumps(payload).encode(),
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = json.loads(resp.read())
                embedding: List[float] = raw["data"][0]["embedding"]
                return embedding
        except (
            urllib.error.URLError,
            urllib.error.HTTPError,
            json.JSONDecodeError,
            KeyError,
            IndexError,
        ) as e:
            logger.error(f"minimax_embed_failed model={use_model} error={e}")
            raise LLMError(f"minimax embed failed: {e}") from e
