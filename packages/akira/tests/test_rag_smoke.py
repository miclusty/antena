"""Smoke tests for the AKIRA Iter 4 PR 1 fix.

These tests pin down that three call sites which invoke
``get_db_connection()`` actually import the symbol from the canonical
``db.connection`` module. Before the fix:

  * ``core/rag.py`` raised ``NameError`` on every ``assemble()`` call,
    which meant the entire RAG pipeline was unreachable from
    ``/cluster/{id}/synthesize-rag``.
  * ``extractors/rss._get_last_harvest`` and
    ``extractors.wordpress._get_last_harvest`` silently swallowed the
    ``NameError`` inside their ``except Exception: pass`` block, fell
    back to the module-level ``_last_fetch`` dict, and returned ``0`` /
    ``None``. Delta extraction was effectively disabled — every RSS
    fetch requested the full feed history.

The tests below prove the import resolves AND that the helpers
actually query the database (not just return the empty fallback).
"""
import os
import sqlite3
import tempfile
from unittest.mock import MagicMock

from db.connection import get_db_connection
from extractors import rss as rss_module
from extractors import wordpress as wordpress_module
from core.rag import RAGEngine


def _make_temp_db() -> str:
    """Create a temp SQLite file path. Caller is responsible for cleanup."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    return path


def _seed_sources_table(db_path: str) -> None:
    """Create the bare ``sources`` schema the two extractor helpers need."""
    conn = sqlite3.connect(db_path)
    conn.executescript("""
        CREATE TABLE sources (
            id INTEGER PRIMARY KEY,
            url TEXT,
            rss_url TEXT,
            wp_api_url TEXT,
            last_harvest_at DATETIME
        );
    """)
    conn.commit()
    conn.close()


def test_rag_engine_assemble_does_not_raise_name_error():
    """``RAGEngine.assemble()`` must resolve ``get_db_connection``.

    Before the fix this raised ``NameError: name 'get_db_connection'
    is not defined``. With the import in place the call instead hits
    the database and either succeeds (empty cluster) or raises
    ``sqlite3.OperationalError`` if the schema is missing — anything
    BUT ``NameError``.

    Note: ``RAGEngine.assemble()`` does not use ``self.lm``, so we
    inject a no-op ``MagicMock`` in place of an ``LMStudioClient`` to
    skip the constructor's HTTP health probe (~3s of network timeouts
    per call) and the ``probe_failed`` log noise.
    """
    path = _make_temp_db()
    try:
        engine = RAGEngine(db_path=path, lm_client=MagicMock())
        try:
            ctx = engine.assemble("nonexistent_cluster_id")
        except NameError as exc:
            raise AssertionError(
                f"RAGEngine.assemble raised NameError (missing import): {exc}"
            )
        except sqlite3.OperationalError:
            # news_cards table doesn't exist — that's fine, the
            # contract we're checking is "not NameError".
            return
        # If the empty-cluster path completes, ctx is an empty
        # RAGContext — nothing more to assert (the contract is
        # "does not raise NameError", not "returns right shape").
        _ = ctx
    finally:
        os.unlink(path)


def test_rss_get_last_harvest_does_not_raise_name_error():
    """``extractors.rss._get_last_harvest`` must resolve ``get_db_connection``.

    Before the fix the ``try/except Exception: pass`` block swallowed
    the NameError, falling back to the module-level ``_last_fetch``
    dict and returning 0. With the import in place the helper
    actually queries the ``sources`` table — verified by seeding a
    timestamp and asserting the returned float matches it.
    """
    path = _make_temp_db()
    try:
        _seed_sources_table(path)

        # Seed a row whose last_harvest_at is well in the past so the
        # returned timestamp is provably > 0 (i.e. came from SQL, not
        # from the empty ``_last_fetch`` fallback).
        seeded_iso = "2024-01-15T10:00:00+00:00"
        conn = sqlite3.connect(path)
        conn.execute(
            "INSERT INTO sources (id, url, rss_url, last_harvest_at) "
            "VALUES (1, 'https://example.com', 'https://example.com/feed', ?)",
            (seeded_iso,),
        )
        conn.commit()
        conn.close()

        # Clear the module-level cache so a stale entry can't mask
        # the bug.
        rss_module._last_fetch.clear()

        result = rss_module._get_last_harvest(path, "https://example.com/feed")

        assert result > 0, (
            f"_get_last_harvest returned {result} — either NameError "
            f"was swallowed or the DB was not queried."
        )

        # Round-trip check: the seeded timestamp must come back as a
        # matching epoch (within 1 second tolerance for SQLite TEXT
        # round-trip).
        from datetime import datetime
        expected = datetime.fromisoformat(seeded_iso).timestamp()
        assert abs(result - expected) < 1.0, (
            f"Expected ~{expected}, got {result}"
        )
    finally:
        os.unlink(path)


def test_wordpress_get_last_harvest_does_not_raise_name_error():
    """``extractors.wordpress._get_last_harvest`` must resolve ``get_db_connection``.

    Same pattern as the RSS helper: before the fix the NameError was
    swallowed and the function returned None. After the fix it
    actually queries ``sources.wp_api_url`` and returns the ISO date
    string (1 hour earlier than last_harvest_at).
    """
    path = _make_temp_db()
    try:
        _seed_sources_table(path)

        seeded_iso = "2024-01-15T10:00:00+00:00"
        conn = sqlite3.connect(path)
        conn.execute(
            "INSERT INTO sources (id, url, wp_api_url, last_harvest_at) "
            "VALUES (1, 'https://example.com', 'https://example.com/wp-json/', ?)",
            (seeded_iso,),
        )
        conn.commit()
        conn.close()

        result = wordpress_module._get_last_harvest(
            path, "https://example.com/wp-json/"
        )

        # Pre-fix this is None (NameError swallowed → except branch
        # returns None). Post-fix it's an ISO date string 1h before
        # the seeded timestamp.
        assert result is not None, (
            "_get_last_harvest returned None — NameError was swallowed "
            "or DB was not queried."
        )
        assert "2024-01-15" in result, (
            f"Expected ISO date containing '2024-01-15', got {result!r}"
        )
    finally:
        os.unlink(path)