"""Database query helpers to reduce code duplication."""

import logging
import sqlite3
from contextlib import contextmanager
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)


@contextmanager
def get_db_connection(db_path: str, timeout: int = 5):
    """Context manager for SQLite connections with timeout and WAL optimizations."""
    conn = sqlite3.connect(db_path, timeout=timeout)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def execute_query(db_path: str, query: str, params: tuple = ()) -> List[sqlite3.Row]:
    """Execute a SELECT query and return results."""
    with get_db_connection(db_path) as conn:
        return conn.execute(query, params).fetchall()


def execute_update(db_path: str, query: str, params: tuple = ()) -> int:
    """Execute an UPDATE/INSERT/DELETE query and return rowcount."""
    with get_db_connection(db_path) as conn:
        cursor = conn.execute(query, params)
        conn.commit()
        return cursor.rowcount


def batch_insert(db_path: str, table: str, columns: List[str], rows: List[tuple]) -> int:
    """Batch insert multiple rows."""
    if not rows:
        return 0
    placeholders = ",".join("?" * len(columns))
    columns_str = ",".join(columns)
    query = f"INSERT INTO {table} ({columns_str}) VALUES ({placeholders})"
    with get_db_connection(db_path) as conn:
        cursor = conn.executemany(query, rows)
        conn.commit()
        return cursor.rowcount


def filter_new_urls(db_path: str, urls: List[str], source_id: Optional[int] = None) -> List[str]:
    """Filter out URLs already in seen_urls table. Batch-checks + batch-inserts new ones.

    Returns list of new URLs (not previously seen). Inserts new URLs into seen_urls.
    Used by extractors (RSS, WordPress) and engine for delta extraction dedup.
    """
    if not urls:
        return []
    try:
        with get_db_connection(db_path) as conn:
            placeholders = ",".join("?" for _ in urls)
            seen = {
                row[0]
                for row in conn.execute(
                    f"SELECT url FROM seen_urls WHERE url IN ({placeholders})", urls
                )
            }
            new_urls = [u for u in urls if u not in seen]
            if new_urls:
                conn.executemany(
                    """INSERT INTO seen_urls (url, source_id, first_seen, last_seen, view_count)
                       VALUES (?, ?, datetime('now'), datetime('now'), 1)
                       ON CONFLICT(url) DO UPDATE SET
                         last_seen = datetime('now'),
                         view_count = view_count + 1""",
                    [(url, source_id) for url in new_urls],
                )
                conn.commit()
            return new_urls
    except Exception as e:
        logger.error(f"Error filtering URLs: {e}")
        return urls
