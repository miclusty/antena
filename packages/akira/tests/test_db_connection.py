"""Tests for the canonical SQLite connection helper.

These tests pin down the PRAGMA values + behavior so future changes
(adding a Redis backend, tuning cache_size, etc.) require a deliberate
test update.
"""
import sqlite3
import tempfile
import os
from pathlib import Path

from db.connection import get_db_connection


def _make_temp_db() -> str:
    """Create a temp SQLite file path. Caller is responsible for cleanup."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    return path


def test_context_manager_yields_connection():
    """get_db_connection() is a context manager yielding a sqlite3.Connection."""
    path = _make_temp_db()
    try:
        with get_db_connection(path) as conn:
            assert isinstance(conn, sqlite3.Connection)
    finally:
        os.unlink(path)


def test_connection_closed_on_exit():
    """After the with-block, the connection must be closed."""
    path = _make_temp_db()
    try:
        with get_db_connection(path) as conn:
            ref = conn
        # Accessing a closed connection raises ProgrammingError.
        try:
            ref.execute("SELECT 1")
        except sqlite3.ProgrammingError:
            pass
        else:
            raise AssertionError("connection was not closed after with-block")
    finally:
        os.unlink(path)


def test_row_factory_is_sqlite_row():
    """row_factory must be sqlite3.Row for dict-like access in route handlers."""
    path = _make_temp_db()
    try:
        with get_db_connection(path) as conn:
            conn.execute("CREATE TABLE t (id INTEGER, name TEXT)")
            conn.execute("INSERT INTO t VALUES (1, 'foo')")
            row = conn.execute("SELECT * FROM t").fetchone()
            assert row["name"] == "foo"  # would fail without sqlite3.Row
    finally:
        os.unlink(path)


def test_wal_mode_applied():
    """journal_mode must be WAL for concurrent reads while writing."""
    path = _make_temp_db()
    try:
        with get_db_connection(path) as conn:
            mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
            assert mode.lower() == "wal", f"expected WAL, got {mode}"
    finally:
        os.unlink(path)


def test_cache_size_applied():
    """cache_size PRAGMA must be set to the configured value (negative = KB)."""
    path = _make_temp_db()
    try:
        with get_db_connection(path) as conn:
            cache_kb = conn.execute("PRAGMA cache_size").fetchone()[0]
            assert cache_kb == -64000, f"expected -64000, got {cache_kb}"
    finally:
        os.unlink(path)


def test_mmap_size_applied():
    """mmap_size PRAGMA must be set to 256 MB for memory-mapped I/O."""
    path = _make_temp_db()
    try:
        with get_db_connection(path) as conn:
            mmap = conn.execute("PRAGMA mmap_size").fetchone()[0]
            assert mmap == 268435456, f"expected 268435456, got {mmap}"
    finally:
        os.unlink(path)


def test_to_ascii_function_registered():
    """to_ascii(text) must strip diacritics so category/location filters work."""
    path = _make_temp_db()
    try:
        with get_db_connection(path) as conn:
            row = conn.execute(
                "SELECT to_ascii('Pol\u00edtica') AS s"
            ).fetchone()
            assert row["s"] == "Politica"
    finally:
        os.unlink(path)


def test_default_path_uses_settings():
    """Calling get_db_connection() with no args uses settings.db_path."""
    from config import settings
    # Don't actually open it — just verify the import path resolves.
    # (settings.db_path exists on the dev machine; the test will be
    # skipped if not, since it would fail the with-block in CI.)
    if not Path(settings.db_path).exists():
        return
    with get_db_connection() as conn:
        assert isinstance(conn, sqlite3.Connection)
