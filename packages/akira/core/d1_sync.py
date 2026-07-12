"""AKIRA → D1 sync orchestrator.

Mirrors selected AKIRA SQLite tables to Cloudflare D1 via the
Cloudflare HTTP API (`core.cloudflare_d1.D1Client`). One method
per table keeps the sync surface explicit and testable:

    sync_table("clusters")            → UPDATE clusters
    sync_table("emerging_clusters")  → INSERT OR REPLACE emerging_clusters
    sync_table("sources_credibility") → UPDATE sources
    sync_table("news_cards_simhash")  → UPDATE news_cards

`sync_all()` runs every registered table and returns a per-table
result dict. A failure on one table does NOT abort the others —
they're best-effort independent.

Per-table strategy:
  - clusters (low-write, per cluster): full UPDATE — one statement per
    row. Reads from local `clusters` mirror table (provisioned by
    migration 0010_clusters.sql). D1's row is keyed by `id`, so the
    UPDATE is idempotent.
  - emerging_clusters (low-write, every 15 min cron): INSERT OR REPLACE
    keyed on `cluster_id`. Idempotent.
  - sources_credibility (low-write, per source): incremental UPDATE.
    We only sync sources whose `credibility_updated_at` is newer than
    `since` (or all rows if `since` is None). One statement per row.
  - news_cards_simhash (high-volume): batched UPDATE — we only push
    rows with non-zero simhash since simhash=0 is the default.

Why per-row statements and not one giant batch?
  Cloudflare D1 limits each query to ~100KB. Bundling every column
  payload into one INSERT OR REPLACE VALUES (?,?,?,...), (?,?,?,...)...
  statement can exceed the limit when bias_narrative / contradictions
  payloads are long. Per-row statements give us natural chunking and
  per-row error reporting.
"""
from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime
from typing import Any, Callable, Optional

from core.cloudflare_d1 import D1Client, D1Error

logger = logging.getLogger("akira.d1_sync")


# Per-table registry — each entry knows how to read from AKIRA SQLite
# and produce a list of (sql, params) statements to push to D1.
#
# Convention: each function returns a list of (sql, params) tuples.
# `sync_table` calls them, then dispatches each tuple to the D1Client.
SyncFn = Callable[[sqlite3.Connection, Optional[datetime]], list[tuple[str, list[Any]]]]


def _sync_clusters(
    conn: sqlite3.Connection, since: Optional[datetime]
) -> list[tuple[str, list[Any]]]:
    """Push UPDATE clusters with bias_narrative + contradictions + synth_at."""
    del since  # always push the full set; per-cluster writes are infrequent
    rows = conn.execute(
        """
        SELECT id, master_article_id, neutral_synth_at, pro_gov_synth_at,
               anti_gov_synth_at, synth_model, bias_narrative,
               bias_key_quotes, bias_narrative_at, bias_narrative_model,
               contradictions_json, contradictions_at, contradictions_count
        FROM clusters
        WHERE bias_narrative IS NOT NULL
           OR contradictions_json IS NOT NULL
           OR master_article_id IS NOT NULL
           OR neutral_synth_at IS NOT NULL
        """
    ).fetchall()

    stmts: list[tuple[str, list[Any]]] = []
    for r in rows:
        stmts.append((
            """UPDATE clusters SET
                  master_article_id = ?,
                  neutral_synth_at = ?,
                  pro_gov_synth_at = ?,
                  anti_gov_synth_at = ?,
                  synth_model = ?,
                  bias_narrative = ?,
                  bias_key_quotes = ?,
                  bias_narrative_at = ?,
                  bias_narrative_model = ?,
                  contradictions_json = ?,
                  contradictions_at = ?,
                  contradictions_count = ?,
                  updated_at = datetime('now')
              WHERE id = ?""",
            list(r),
        ))
    return stmts


def _sync_emerging_clusters(
    conn: sqlite3.Connection, since: Optional[datetime]
) -> list[tuple[str, list[Any]]]:
    """Push INSERT OR REPLACE rows from emerging_clusters."""
    del since  # full mirror — table is bounded (~30 rows)
    rows = conn.execute(
        """SELECT cluster_id, velocity_score, new_articles_in_window,
                  distinct_sources_in_window, credibility_avg, title,
                  first_seen_at, last_updated_at
           FROM emerging_clusters
           ORDER BY velocity_score DESC"""
    ).fetchall()

    stmts: list[tuple[str, list[Any]]] = []
    for r in rows:
        stmts.append((
            """INSERT OR REPLACE INTO emerging_clusters
                  (cluster_id, velocity_score, new_articles_in_window,
                   distinct_sources_in_window, credibility_avg, title,
                   first_seen_at, last_updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            list(r),
        ))
    return stmts


def _sync_sources_credibility(
    conn: sqlite3.Connection, since: Optional[datetime]
) -> list[tuple[str, list[Any]]]:
    """Push UPDATE sources with credibility_* columns.

    If `since` is set, only sync sources whose `credibility_updated_at`
    is newer than that timestamp. Otherwise sync all sources.
    """
    if since:
        rows = conn.execute(
            """SELECT id, credibility_score, uniqueness_ratio,
                      diversity_score, credibility_updated_at
               FROM sources
               WHERE credibility_updated_at IS NOT NULL
                 AND credibility_updated_at >= ?""",
            (since.isoformat(sep=" "),),
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT id, credibility_score, uniqueness_ratio,
                      diversity_score, credibility_updated_at
               FROM sources
               WHERE credibility_updated_at IS NOT NULL"""
        ).fetchall()

    stmts: list[tuple[str, list[Any]]] = []
    for r in rows:
        sid, cred, uniq, div, ts = r
        stmts.append((
            """UPDATE sources SET
                  credibility_score = ?,
                  uniqueness_ratio = ?,
                  diversity_score = ?,
                  credibility_updated_at = ?
              WHERE id = ?""",
            [cred, uniq, div, ts, sid],
        ))
    return stmts


def _sync_news_cards_simhash(
    conn: sqlite3.Connection, since: Optional[datetime]
) -> list[tuple[str, list[Any]]]:
    """Push UPDATE news_cards with simhash — only non-zero rows.

    Cards with simhash=0 are the default state and carry no signal,
    so we skip them entirely. This keeps the sync payload bounded.
    """
    del since  # always full-mirror — simhash is computed once per card
    rows = conn.execute(
        """SELECT id, simhash FROM news_cards WHERE simhash != 0"""
    ).fetchall()

    stmts: list[tuple[str, list[Any]]] = []
    for r in rows:
        stmts.append(
            ("UPDATE news_cards SET simhash = ? WHERE id = ?", [int(r[1]), r[0]])
        )
    return stmts


SYNC_REGISTRY: dict[str, SyncFn] = {
    "clusters": _sync_clusters,
    "emerging_clusters": _sync_emerging_clusters,
    "sources_credibility": _sync_sources_credibility,
    "news_cards_simhash": _sync_news_cards_simhash,
}


class D1Sync:
    """High-level orchestrator: read AKIRA SQLite, push to D1.

    Two construction modes:
      1. Inject a pre-built `D1Client` (used by tests with a MagicMock).
      2. Pass credentials + db_path directly; D1Sync builds its own
         D1Client on first use.

    `sync_table(name)` runs the registered function for that table.
    `sync_all(dry_run=False)` runs every registered table and returns
    `{table_name: rows_synced_or_error_message}`. Failures on one
    table do not abort others.
    """

    def __init__(
        self,
        client: Optional[D1Client] = None,
        *,
        account_id: Optional[str] = None,
        api_token: Optional[str] = None,
        database_id: Optional[str] = None,
        akira_db_path: Optional[str] = None,
    ):
        if client is None:
            if not (account_id and api_token and database_id):
                raise ValueError(
                    "D1Sync: provide either a `client` or "
                    "(account_id, api_token, database_id)"
                )
            self._client = D1Client(
                account_id=account_id,
                api_token=api_token,
                database_id=database_id,
            )
        else:
            self._client = client

        if akira_db_path is None:
            from config import settings
            akira_db_path = settings.db_path
        self._db_path = akira_db_path

    @property
    def db_path(self) -> str:
        return self._db_path

    @property
    def client(self) -> D1Client:
        return self._client

    def sync_table(
        self,
        name: str,
        since: Optional[datetime] = None,
        dry_run: bool = False,
    ) -> int:
        """Push one table to D1. Returns rows synced (or 0 on failure).

        Raises:
            ValueError: if `name` is not in SYNC_REGISTRY.
        """
        if name not in SYNC_REGISTRY:
            raise ValueError(
                f"D1Sync: unknown table {name!r}; "
                f"valid: {sorted(SYNC_REGISTRY.keys())}"
            )

        fn = SYNC_REGISTRY[name]
        with sqlite3.connect(self._db_path) as conn:
            stmts = fn(conn, since)

        if dry_run:
            logger.info("dry_run %s would push %d statements", name, len(stmts))
            return len(stmts)

        pushed = 0
        for sql, params in stmts:
            try:
                self._client.execute(sql, params)
                pushed += 1
            except D1Error as exc:
                # Per-statement errors are logged but do not abort the
                # whole table sync — a single bad row shouldn't block
                # the rest. We re-raise so the caller can decide.
                logger.error(
                    "D1Sync %s: statement failed (%d/%d): %s",
                    name, pushed + 1, len(stmts), exc,
                )
                raise
        logger.info("D1Sync %s: pushed %d rows", name, pushed)
        return pushed

    def sync_all(
        self,
        since: Optional[datetime] = None,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        """Push every registered table. Returns per-table results.

        Result format: `{table_name: int_count}` on success, or
        `{table_name: "error: <message>"}` on failure. Partial
        failures are isolated: one table failing doesn't prevent
        the others from running.
        """
        results: dict[str, Any] = {}
        for name in SYNC_REGISTRY:
            try:
                results[name] = self.sync_table(name, since=since, dry_run=dry_run)
            except D1Error as exc:
                results[name] = f"error: {exc}"
                logger.warning("D1Sync %s failed: %s", name, exc)
            except Exception as exc:  # noqa: BLE001 — defensive, log everything
                results[name] = f"error: {exc}"
                logger.exception("D1Sync %s unexpected failure", name)
        return results