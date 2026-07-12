"""Cloudflare D1 HTTP API client.

A thin wrapper over `requests` for the Cloudflare D1 query endpoint:

    POST https://api.cloudflare.com/client/v4/accounts/{account_id}/
        d1/database/{database_id}/query
    Authorization: Bearer {api_token}
    Content-Type: application/json
    Body: {"sql": "...", "params": [...]}

D1's API supports both read (SELECT) and write (INSERT/UPDATE/DELETE) via
the same endpoint — write queries return an empty `results` array but
a `meta.changes` count. The `execute()` method normalizes both shapes
to `list[dict]` so callers can treat reads and writes uniformly.

Why sync `requests` instead of `aiohttp`:
  - The sync code path (cron scripts, sync_to_d1_cron.py) is the
    common case. `requests` keeps the call site simple.
  - D1 rate limits are forgiving (sub-100ms per call). The async
    overhead would not be visible.

Network failures and D1 errors both surface as `D1Error` so callers
can decide whether to retry / log / abort.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

import requests

logger = logging.getLogger("akira.cloudflare_d1")


class D1Error(RuntimeError):
    """Raised when the Cloudflare D1 API call fails for any reason:

    - HTTP non-2xx status (auth, quota, malformed request)
    - JSON body reports `success: false` (SQL error, bad token)
    - Network error / connection timeout (caught upstream by `requests`)
    """


class D1Client:
    """Sync client for the Cloudflare D1 HTTP API.

    Constructor takes the three credentials explicitly so the caller can
    pull them from `settings.cloudflare_*` or pass test stubs. There's no
    implicit network call — `execute()` is the only method that hits D1.
    """

    DEFAULT_BASE = "https://api.cloudflare.com/client/v4"
    DEFAULT_TIMEOUT_SEC = 30.0

    def __init__(
        self,
        account_id: str,
        api_token: str,
        database_id: str,
        timeout: float = DEFAULT_TIMEOUT_SEC,
        base_url: str = DEFAULT_BASE,
    ):
        if not account_id:
            raise ValueError("D1Client: account_id is required")
        if not api_token:
            raise ValueError("D1Client: api_token is required")
        if not database_id:
            raise ValueError("D1Client: database_id is required")
        self.account_id = account_id
        self.api_token = api_token
        self.database_id = database_id
        self.timeout = timeout
        self.base_url = base_url.rstrip("/")
        self._url = (
            f"{self.base_url}/accounts/{self.account_id}"
            f"/d1/database/{self.database_id}/query"
        )

    def execute(self, sql: str, params: Optional[list[Any]] = None) -> list[dict]:
        """Run a single SQL statement against D1 and return the rows.

        For SELECT queries this is the result rows as list of dicts.
        For UPDATE / INSERT / DELETE the result is an empty list (the
        `meta.changes` count is logged at DEBUG but not returned; if you
        need it, call `execute_with_meta`).

        Raises:
            D1Error: on any HTTP / API / parse failure.
        """
        body = {"sql": sql, "params": list(params or [])}
        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json",
        }
        try:
            resp = requests.post(self._url, json=body, headers=headers, timeout=self.timeout)
        except requests.RequestException as exc:
            raise D1Error(f"D1 network error: {exc}") from exc

        if not (200 <= resp.status_code < 300):
            raise D1Error(
                f"D1 HTTP {resp.status_code}: {resp.text[:500]}"
            )

        try:
            payload = resp.json()
        except ValueError as exc:
            raise D1Error(f"D1 returned non-JSON: {resp.text[:200]}") from exc

        if not payload.get("success", False):
            errs = payload.get("errors") or [{"message": "unknown D1 error"}]
            msg = "; ".join(e.get("message", "?") for e in errs)
            raise D1Error(f"D1 API error: {msg}")

        # Cloudflare wraps the actual statement result in result[0].
        # Each statement has {results: [...], success: bool, meta: {...}}.
        result_list = payload.get("result") or []
        if not result_list:
            return []
        first = result_list[0]
        if not first.get("success", False):
            errs = first.get("errors") or [{"message": "statement failed"}]
            msg = "; ".join(e.get("message", "?") for e in errs)
            raise D1Error(f"D1 statement error: {msg}")

        rows = first.get("results") or []
        # DEBUG-level row count — useful in cron logs.
        meta = first.get("meta") or {}
        if "changes" in meta:
            logger.debug("D1 %d rows changed", meta["changes"])
        return rows

    def execute_many(self, stmts: list[tuple[str, list[Any]]]) -> None:
        """Convenience: run a batch of (sql, params) statements in order.

        Stops at the first failure (raises D1Error); the caller decides
        whether to retry, skip, or abort the sync.
        """
        for sql, params in stmts:
            self.execute(sql, params)

    def __repr__(self) -> str:
        return (
            f"D1Client(account_id={self.account_id!r}, "
            f"database_id={self.database_id!r})"
        )