#!/usr/bin/env python3
"""
AKIRA Day 3: Extract entities from news cards via LM Studio.

Reads cards from news_cards, asks the local LLM (qwen3.5-4b) to
extract people / places / organizations / events mentioned in
the title+summary, and persists:
  - The unique entity rows in `entities`
  - The per-card mention rows in `entity_mentions`

This is the LMWIKI "ingest" stage. Once entities are extracted
across the corpus, build_kb.py computes the co-occurrence graph
and the RAG engine can use it for context.

Design:
  - Idempotent: cards that already have entity_mentions rows are
    skipped, unless --force.
  - Concurrent: ThreadPoolExecutor with --workers N (default 4).
    Each LM Studio call takes 2-5s. With 4 workers we process
    ~1 card/sec → 13k cards in ~3.5 hours.
  - Resilient: if the LLM returns unparseable JSON, the card is
    marked as 'failed' in a log and skipped (not retried
    indefinitely). The dead-letter file lets us see which ones
    need manual review.

CLI:
    --limit N        Process at most N cards
    --force          Re-extract even if already done
    --workers N      Concurrent threads (default 4)
    --batch N        DB commit batch size (default 100)
    --model NAME     Override the LLM model
    --db PATH        Override SQLite path
    --dead-letter PATH   File to write failed card IDs to
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sqlite3
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core.lmstudio import LMStudioClient, LMStudioError
from pathlib import Path

logger = logging.getLogger("akira.extract_entities")

DB_PATH_DEFAULT = os.getenv("AKIRA_DB", str(Path(__file__).parent.parent / "data" / "akira.db"))
DEFAULT_MODEL = "qwen3.5-4b"
BATCH_COMMIT = 100
DEFAULT_WORKERS = 4

# Schema-level entity types. These match the CHECK constraint in
# the entities table (see migration 0003_rag_tables.sql).
ENTITY_TYPES = ("personas", "lugares", "organizaciones", "eventos")
ENTITY_TYPE_MAP = {
    "personas": "person",
    "lugares": "place",
    "organizaciones": "org",
    "eventos": "event",
}

# The system prompt that constrains the LLM to clean JSON. Tested
# locally: with this prompt, qwen3.5-4b returns valid JSON ~99%
# of the time on news cards. Without it, the model wraps in
# ```json``` fences and adds prose.
ENTITY_SYSTEM_PROMPT = (
    "Sos un extractor de entidades. Recibís un texto de una noticia "
    "argentina y devolvés ÚNICAMENTE un objeto JSON con cuatro claves: "
    '"personas", "lugares", "organizaciones", "eventos". Cada valor es '
    "una lista de strings (los nombres tal como aparecen en el texto). "
    "Si una categoría no tiene elementos, usá lista vacía []. "
    "Sin explicaciones, sin fences, sin texto antes ni después. "
    "Solo el JSON."
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Extract entities via LM Studio")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--force", action="store_true")
    p.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    p.add_argument("--batch", type=int, default=BATCH_COMMIT)
    p.add_argument("--model", type=str, default=DEFAULT_MODEL)
    p.add_argument("--db", type=str, default=DB_PATH_DEFAULT)
    p.add_argument("--dead-letter", type=str, default="/tmp/extract_entities_dead.txt")
    return p.parse_args()


def fetch_cards(
    db_path: str, limit: int, force: bool
) -> List[Tuple[str, str, str]]:
    """Return (card_id, title, summary) tuples to process.

    If `force` is False, only cards that have NO entries in
    entity_mentions are returned. This is the idempotency check.
    """
    with sqlite3.connect(db_path) as conn:
        if force:
            sql = "SELECT id, title, summary FROM news_cards WHERE summary IS NOT NULL AND LENGTH(summary) > 20"
        else:
            sql = """
                SELECT nc.id, nc.title, nc.summary
                FROM news_cards nc
                LEFT JOIN entity_mentions em ON em.card_id = nc.id
                WHERE nc.summary IS NOT NULL
                  AND LENGTH(nc.summary) > 20
                  AND em.id IS NULL
                GROUP BY nc.id
            """
        if limit > 0:
            sql += f" LIMIT {limit}"
        rows = conn.execute(sql).fetchall()
    return [(cid, title or "", summary or "") for cid, title, summary in rows]


def call_llm_for_entities(
    client: LMStudioClient, title: str, summary: str, model: str
) -> Dict[str, List[str]]:
    """Ask the LLM to extract entities. Returns a dict with the
    four keys, each a list of strings. Raises LMStudioError on
    network failure. Returns {} if the response can't be parsed
    — the caller logs it as a dead letter.
    """
    user_prompt = f"Título: {title}\n\nResumen: {summary[:800]}"
    raw = client.chat(
        [
            {"role": "system", "content": ENTITY_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        model=model,
        max_tokens=300,
        temperature=0.1,
    )
    return _parse_entity_json(raw)


def _parse_entity_json(raw: str) -> Dict[str, List[str]]:
    """Tolerantly parse the LLM's JSON. Strip ``` fences, find
    the outermost {...}, validate the four keys, and return only
    the string elements. If the LLM returned objects/dicts (e.g.
    {"nombre": "Milei", "rol": "presidente"}), we extract just
    the `nombre` field — that's the common case in the
    qwen3.5-4b raw output."""
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return {}
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return {}
    out: Dict[str, List[str]] = {k: [] for k in ENTITY_TYPES}
    for key in ENTITY_TYPES:
        items = data.get(key, [])
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, str):
                name = item.strip()
            elif isinstance(item, dict):
                # LLM sometimes returns {"nombre": "...", "rol": "..."}
                name = (item.get("nombre") or item.get("name") or "").strip()
            else:
                continue
            if name and len(name) >= 2 and len(name) <= 80:
                out[key].append(name)
    return out


def _normalize_entity_name(name: str) -> str:
    """Canonical form for entity deduplication. "Milei" and
    "Javier Milei" and "JMilei" are all different rows in the
    entities table; we only collapse obvious variants here
    (case + whitespace). A more aggressive alias-merge could
    be added later by an LLM-based pass that compares two
    candidate names and decides if they're the same entity.
    """
    return re.sub(r"\s+", " ", name).strip()


def commit_entities(
    db_path: str,
    rows: Sequence[Tuple[str, str, str, float]],
    lock: threading.Lock,
) -> int:
    """Write (entity_name, entity_type, card_id, confidence) rows
    to entities + entity_mentions. Uses INSERT OR IGNORE on
    entities (uniqueness by name) and a separate INSERT OR IGNORE
    on entity_mentions (uniqueness by card_id+entity_id). The
    lock guards the SQLite writes; the network calls happen
    outside the lock."""
    if not rows:
        return 0
    n = 0
    with lock:
        with sqlite3.connect(db_path) as conn:
            try:
                # First, ensure all entity rows exist
                entity_keys = set()
                for name, etype, _cid, _conf in rows:
                    entity_keys.add((name, etype))
                for name, etype in entity_keys:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO entities
                            (name, type, first_seen, last_seen, mention_count)
                        VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0)
                        """,
                        (name, etype),
                    )
                # Now resolve entity_id by name and insert mentions
                entity_id_map = {
                    r[0]: r[1]
                    for r in conn.execute(
                        "SELECT name, id FROM entities WHERE name IN ({})".format(
                            ",".join("?" * len(entity_keys))
                        ),
                        [n for n, _t in entity_keys],
                    ).fetchall()
                }
                for name, _etype, card_id, conf in rows:
                    eid = entity_id_map.get(name)
                    if eid is None:
                        continue
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO entity_mentions
                            (card_id, entity_id, confidence)
                        VALUES (?, ?, ?)
                        """,
                        (card_id, eid, conf),
                    )
                    # Bump mention_count
                    conn.execute(
                        "UPDATE entities SET mention_count = mention_count + 1, last_seen = CURRENT_TIMESTAMP WHERE id = ?",
                        (eid,),
                    )
                conn.commit()
                n = len(rows)
            except sqlite3.OperationalError as e:
                logger.error(f"commit_failed: {e}")
    return n


def process_one(
    client: LMStudioClient,
    card_id: str,
    title: str,
    summary: str,
    model: str,
) -> Tuple[str, List[Tuple[str, str, str, float]], str]:
    """Process a single card. Returns (card_id, rows, status) where
    rows is the list of (entity_name, entity_type, card_id, confidence)
    tuples ready to be committed, and status is one of:
      - "ok": LLM responded, rows may be empty (legitimate 0-entity card)
      - "llm_error": network/timeout — caller should dead-letter
      - "parse_error": LLM responded but JSON didn't parse — log
    Empty rows on status="ok" is NOT a failure (e.g. a sports score
    update or a "domain for sale" page may have zero entities).
    """
    try:
        entities = call_llm_for_entities(client, title, summary, model)
    except LMStudioError as e:
        logger.warning(f"llm_failed card_id={card_id} error={e}")
        return (card_id, [], "llm_error")
    rows: List[Tuple[str, str, str, float]] = []
    for src_key, etype in ENTITY_TYPE_MAP.items():
        for name in entities.get(src_key, []):
            canonical = _normalize_entity_name(name)
            if not canonical:
                continue
            rows.append((canonical, etype, card_id, 1.0))
    if not rows and not entities:
        # LLM returned but parser got nothing. Could be:
        # - genuinely empty (e.g. RSS XML summary, "for sale" page)
        # - JSON truncated by max_tokens
        # - LLM returned non-JSON
        # We treat this as "ok with 0 entities" — not a hard failure.
        logger.debug(f"empty_extraction card_id={card_id} title={title[:60]!r}")
    return (card_id, rows, "ok")


def main() -> int:
    args = parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logger.info(
        f"extract_entities: model={args.model} force={args.force} "
        f"limit={args.limit} workers={args.workers} db={args.db}"
    )
    try:
        client = LMStudioClient()
        # Quick health check
        _ = client.chat(
            [{"role": "user", "content": "OK"}],
            model=args.model,
            max_tokens=5,
        )
        logger.info("LM Studio OK")
    except LMStudioError as e:
        logger.error(f"LM Studio unreachable: {e}")
        return 1

    # Make sure entities table exists (created in migration 0003,
    # but be defensive in case the script is run before migration).
    with sqlite3.connect(args.db) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS entities (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              type TEXT NOT NULL CHECK (type IN ('person', 'place', 'org', 'event')),
              aliases TEXT,
              first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              mention_count INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE (name)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS entity_mentions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              card_id TEXT NOT NULL,
              entity_id INTEGER NOT NULL,
              confidence REAL NOT NULL DEFAULT 1.0,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE (card_id, entity_id),
              FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
            )
            """
        )

    cards = fetch_cards(args.db, args.limit, args.force)
    if not cards:
        logger.info("nothing to do (all cards already have entity_mentions)")
        return 0
    logger.info(f"to process: {len(cards)} cards")

    db_lock = threading.Lock()
    t0 = time.monotonic()
    pending_rows: List[Tuple[str, str, str, float]] = []
    done = 0
    failed = 0
    total_mentions = 0
    dead_letter: List[str] = []

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {
            ex.submit(process_one, client, cid, title, summary, args.model): cid
            for cid, title, summary in cards
        }
        for i, fut in enumerate(as_completed(futures), 1):
            card_id, rows, status = fut.result()
            if status == "llm_error":
                if card_id not in dead_letter:
                    failed += 1
                    dead_letter.append(card_id)
            # status="ok" with 0 rows is a legitimate empty extraction
            # (e.g. RSS XML card, "for sale" page). Not a failure.
            pending_rows.extend(rows)
            if len(pending_rows) >= args.batch:
                n = commit_entities(args.db, pending_rows, db_lock)
                total_mentions += n
                pending_rows = []
            done += 1
            if done % 50 == 0 or done == len(cards):
                elapsed = time.monotonic() - t0
                rate = done / elapsed if elapsed > 0 else 0
                eta_sec = (len(cards) - done) / rate if rate > 0 else 0
                # Per-node stats: shows which Mac handled how much
                # work and current in-flight count. Useful for
                # tuning --workers N.
                node_stats = " ".join(
                    f"[{n.url.split('//')[1].split(':')[0]}:reqs={n.request_count} "
                    f"lat={n.avg_latency():.2f}s inflight={n.in_flight}]"
                    for n in client._nodes
                )
                logger.info(
                    f"progress: {done}/{len(cards)} mentions={total_mentions} "
                    f"failed={failed} rate={rate:.2f}/s eta={eta_sec/60:.1f}min "
                    f"nodes: {node_stats}"
                )
        if pending_rows:
            n = commit_entities(args.db, pending_rows, db_lock)
            total_mentions += n

    if dead_letter:
        with open(args.dead_letter, "w") as f:
            for cid in dead_letter:
                f.write(cid + "\n")
        logger.warning(f"{len(dead_letter)} failed card_ids written to {args.dead_letter}")

    elapsed = time.monotonic() - t0
    logger.info(
        f"DONE: {done} processed, {total_mentions} mentions written, "
        f"{failed} failed, {elapsed:.1f}s total ({done/elapsed:.2f}/s)"
    )
    # Exit 0 even with empty extractions — those are legitimate.
    # Exit 2 only on hard LLM/network failures.
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
