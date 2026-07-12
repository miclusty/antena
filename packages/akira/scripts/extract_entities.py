#!/usr/bin/env python3
"""
AKIRA Day 3: Extract entities from news cards via LM Studio.

Reads cards from news_cards, asks the local LLM (qwen3.5-4b) to
extract people / places / organizations / events mentioned in
the title+summary, and persists them via `core.entity_graph.EntityGraph`.

This is the LMWIKI "ingest" stage. Once entities are extracted
across the corpus, the co-occurrence graph is automatically kept
up to date (graph edges are recomputed inline per article; see
`EntityGraph.build_graph_from_article`), and the RAG engine can
use it for context.

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
  - DB writes go through `EntityGraph`, so the same code path is
    exercised by the per-article ingest in `harvest_run.py`. See
    `core/entity_graph.py` for the schema and idempotency rules.

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
from typing import Dict, List, Tuple

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core.entity_graph import EntityGraph, ENTITY_TYPE_MAP
from core.lmstudio import LMStudioClient, LMStudioError
from pathlib import Path

logger = logging.getLogger("akira.extract_entities")

DB_PATH_DEFAULT = os.getenv("AKIRA_DB", str(Path(__file__).parent.parent / "data" / "akira.db"))
DEFAULT_MODEL = "qwen3.5-4b"
BATCH_COMMIT = 100
DEFAULT_WORKERS = 4

# The LLM-facing key set; matches the system prompt below. The DB-level
# `type` enum (person/place/org/event) is mapped from these via
# `ENTITY_TYPE_MAP` in `core.entity_graph`.
ENTITY_TYPES = ("personas", "lugares", "organizaciones", "eventos")

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


def process_one(
    client: LMStudioClient,
    card_id: str,
    title: str,
    summary: str,
    model: str,
) -> Tuple[str, Dict[str, List[str]], str]:
    """Process a single card. Returns (card_id, entities_dict, status)
    where status is one of:
      - "ok": LLM responded, entities may be empty (legitimate 0-entity card)
      - "llm_error": network/timeout — caller should dead-letter
    Empty entities on status="ok" is NOT a failure (e.g. a sports score
    update or a "domain for sale" page may have zero entities).
    """
    try:
        entities = call_llm_for_entities(client, title, summary, model)
    except LMStudioError as e:
        logger.warning(f"llm_failed card_id={card_id} error={e}")
        return (card_id, {}, "llm_error")
    if not entities:
        logger.debug(f"empty_extraction card_id={card_id} title={title[:60]!r}")
    return (card_id, entities, "ok")


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

    # Ensure schema (creates tables + indexes if missing) and keep a
    # single EntityGraph instance for the whole batch. The graph object
    # is thread-safe at the connection-per-call level but we still serialize
    # writes with `db_lock` to avoid `database is locked` on WAL contention.
    graph = EntityGraph(args.db)
    cards = fetch_cards(args.db, args.limit, args.force)
    if not cards:
        logger.info("nothing to do (all cards already have entity_mentions)")
        return 0
    logger.info(f"to process: {len(cards)} cards")

    db_lock = threading.Lock()
    t0 = time.monotonic()
    pending: List[Tuple[str, str, Dict[str, List[str]]]] = []
    done = 0
    failed = 0
    total_mentions = 0
    dead_letter: List[str] = []

    def flush() -> int:
        nonlocal total_mentions
        n = 0
        with db_lock:
            for cid, _title, ents in pending:
                try:
                    graph.build_graph_from_article(
                        article_id=cid, title="", body="", entities=ents
                    )
                    n += 1
                except sqlite3.OperationalError as e:
                    logger.error(f"commit_failed card={cid}: {e}")
        total_mentions += n
        pending.clear()
        return n

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {
            ex.submit(process_one, client, cid, title, summary, args.model): cid
            for cid, title, summary in cards
        }
        for i, fut in enumerate(as_completed(futures), 1):
            card_id, entities, status = fut.result()
            if status == "llm_error":
                if card_id not in dead_letter:
                    failed += 1
                    dead_letter.append(card_id)
            # status="ok" with empty entities is a legitimate empty
            # extraction (e.g. RSS XML card, "for sale" page). The graph
            # call becomes a no-op (test_build_graph_empty_entities_is_noop).
            pending.append((card_id, "", entities))
            if len(pending) >= args.batch:
                flush()
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
        if pending:
            flush()

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
