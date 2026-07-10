import importlib.util
import sqlite3
import sys
import tempfile
from pathlib import Path

import pytest

_spec = importlib.util.spec_from_file_location(
    "backfill", Path(__file__).parent.parent / "scripts" / "backfill_slugs.py"
)
assert _spec is not None and _spec.loader is not None  # nosec — local script path
backfill = importlib.util.module_from_spec(_spec)
sys.modules["backfill"] = backfill
_spec.loader.exec_module(backfill)


def test_resolve_slug_no_collision():
    assert backfill.resolve_slug("foo", "2026-06-15", set()) == "foo"


def test_resolve_slug_collision_adds_suffix():
    existing = {"foo"}
    result = backfill.resolve_slug("foo", "2026-06-15", existing, "abc123def456")
    assert result.startswith("foo-")
    assert result != "foo"


def test_resolve_slug_unique_suffix_per_collision():
    existing = {"foo"}
    result1 = backfill.resolve_slug("foo", "2026-06-15", existing, "abc123def456")
    existing.add(result1)
    result2 = backfill.resolve_slug("foo", "2026-06-15", existing, "xyz789ghi012")
    assert result1 != result2


def test_get_existing_slugs():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        conn = sqlite3.connect(f.name)
        conn.execute("CREATE TABLE news_cards (id TEXT, slug TEXT, slug_date TEXT)")
        conn.execute("INSERT INTO news_cards VALUES ('a', 'x', '2026-06-15')")
        conn.execute("INSERT INTO news_cards VALUES ('b', 'y', '2026-06-15')")
        conn.commit()
        existing = backfill.get_existing_slugs_for_date(conn, "2026-06-15")
        assert existing == {"x", "y"}


def test_slug_date_from_published_at():
    assert backfill.slug_date_from_published_at("2026-06-15T12:34:56Z") == "2026-06-15"
    assert backfill.slug_date_from_published_at("2026-06-15") == "2026-06-15"
    assert backfill.slug_date_from_published_at(None) is not None
