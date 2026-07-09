"""Canonical SQLite connection with WAL + mmap + cache optimizations.

This module is the SINGLE source of truth for SQLite connection setup in AKIRA.
All other modules MUST import from here, not create their own connections.

Performance PRAGMAs applied to every connection:
  - journal_mode=WAL       → concurrent reads while writer is active
  - synchronous=NORMAL     → safe with WAL, ~2x faster than FULL
  - cache_size=-64000      → 64 MB page cache
  - mmap_size=268435456    → 256 MB memory-mapped I/O

Plus:
  - row_factory=sqlite3.Row     → dict-like row access
  - to_ascii(text) SQL function → normalize diacritics for category/location matching

Replaces the duplicate get_db_connection() that lived in main.py:1159-1180
(different PRAGMA set, no auto-close) and supersedes the simpler version
in core/db_helpers.py (no mmap, no cache_size).

Usage:
    from db.connection import get_db_connection

    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM news_cards LIMIT 10").fetchall()
"""
import logging
import sqlite3
import unicodedata
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

logger = logging.getLogger(__name__)

# PRAGMA values are module-level so tests can assert against them
# and ops can tune them without touching the function body.
_CACHE_SIZE_KB = -64000      # 64 MB page cache (negative = KB)
_MMAP_SIZE_BYTES = 268435456  # 256 MB memory-mapped I/O


@contextmanager
def get_db_connection(db_path: Optional[str] = None, timeout: int = 5) -> Iterator[sqlite3.Connection]:
    """Context manager that yields a fully-configured SQLite connection.

    Args:
        db_path: Path to the SQLite file. If None, uses settings.db_path
                 (the canonical AKIRA database).
        timeout: Lock acquisition timeout in seconds (default 5).

    Yields:
        sqlite3.Connection with WAL + mmap + cache PRAGMAs applied,
        sqlite3.Row factory, and the to_ascii() SQL function registered.

    On exit, the connection is closed automatically.
    """
    if db_path is None:
        from config import settings
        db_path = settings.db_path

    conn = sqlite3.connect(db_path, timeout=timeout)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute(f"PRAGMA cache_size={_CACHE_SIZE_KB}")
    conn.execute(f"PRAGMA mmap_size={_MMAP_SIZE_BYTES}")
    conn.row_factory = sqlite3.Row
    conn.create_function(
        "to_ascii",
        1,
        lambda s: (
            unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode("ascii")
            if s
            else s
        ),
    )
    try:
        yield conn
    finally:
        conn.close()


def get_locations_connection(db_path: Optional[str] = None, timeout: int = 5) -> sqlite3.Connection:
    """Open the locations SQLite database with WAL + synchronous=NORMAL.

    Used by services.google_news_service (and any other module that
    reads `data/locations.db`, a separate DB from akira.db). Mirrors
    the connection style of get_db_connection() but for the locations
    DB, and returns the connection directly (caller manages close()).

    Args:
        db_path: Path to locations.db. If None, derives
                 `<settings.db_path parent>/locations.db` so the
                 locations DB sits alongside akira.db in the canonical
                 data dir and honors AKIRA_DB_PATH overrides.
        timeout: Lock acquisition timeout in seconds (default 5).

    Returns:
        sqlite3.Connection with WAL + synchronous=NORMAL PRAGMAs
        and sqlite3.Row row factory.
    """
    if db_path is None:
        from config import settings
        db_path = str(Path(settings.db_path).parent / "locations.db")

    conn = sqlite3.connect(db_path, timeout=timeout)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.row_factory = sqlite3.Row
    return conn
