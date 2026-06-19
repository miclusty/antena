"""Tests for import_random_radio_global.py.

Uses a fixture DB with a small set of stations from 5 countries
to verify the import script's behavior.
"""

import os
import sqlite3
import tempfile
from pathlib import Path

import pytest


@pytest.fixture
def sample_rr_db(tmp_path: Path) -> Path:
    """Create a tiny random-radio DB with 5 stations from 3 countries."""
    db = tmp_path / "skill_radio.db"
    conn = sqlite3.connect(db)
    conn.execute("""
        CREATE TABLE stations (
            id INTEGER PRIMARY KEY,
            slug TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            name TEXT NOT NULL,
            location TEXT NOT NULL,
            stream_url TEXT,
            country TEXT,
            country_code TEXT,
            city TEXT,
            language TEXT,
            bitrate TEXT,
            codec TEXT,
            website TEXT,
            tags TEXT,
            UNIQUE(slug, channel_id)
        )
    """)
    rows = [
        # AR with city match (Buenos Aires maps to codgl='02000')
        ('ar-1', 'radio-mitre',  'Radio Mitre',  'BA',
         'https://m.stream', 'Argentina', 'AR', 'Buenos Aires', 'es', '128', 'mp3', 'https://radiomitre.cienradios.com', 'am'),
        # AR without city match (codgl=NULL)
        ('ar-2', 'radio-loc',    'Radio Local',  'UnknownPueblo',
         'https://m.stream', 'Argentina', 'AR', 'UnknownPueblo', 'es', '64', 'mp3', None, 'fm'),
        # US
        ('us-1', 'npr',          'NPR',          'NY',
         'https://n.stream', 'United States', 'US', 'New York', 'en', '192', 'aac', 'https://npr.org', 'news'),
        # BR
        ('br-1', 'jovem-pan',    'Jovem Pan',    'SAO',
         'https://j.stream', 'Brazil', 'BR', 'São Paulo', 'pt', '128', 'mp3', 'https://jovempan.com.br', 'news'),
        # No stream_url — must be skipped
        ('xx-1', 'dead-radio',   'Dead Radio',   'XX',
         None, 'Argentina', 'AR', 'Mendoza', 'es', None, None, None, None),
    ]
    conn.executemany("""
        INSERT INTO stations (slug, channel_id, name, location, stream_url,
                              country, country_code, city, language, bitrate,
                              codec, website, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, rows)
    conn.commit()
    conn.close()
    return db


@pytest.fixture
def akira_db(tmp_path: Path, monkeypatch) -> Path:
    """Create a minimal AKIRA DB with argentine_towns table + media table.

    Includes 'Buenos Aires' as a known town with codgl='02000'.
    """
    db = tmp_path / "akira.db"
    conn = sqlite3.connect(db)
    conn.executescript("""
        CREATE TABLE argentine_towns (
            name TEXT PRIMARY KEY,
            province TEXT NOT NULL,
            codgl TEXT NOT NULL,
            population INTEGER
        );
        INSERT INTO argentine_towns VALUES ('Buenos Aires', 'Buenos Aires', '02000', 3000000);

        CREATE TABLE media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            city TEXT NOT NULL,
            province TEXT,
            codgl TEXT,
            website TEXT,
            facebook_url TEXT,
            instagram_url TEXT,
            stream_url TEXT,
            tags TEXT,
            source TEXT NOT NULL DEFAULT 'random-radio',
            country TEXT,
            country_code TEXT,
            language TEXT,
            bitrate TEXT,
            codec TEXT,
            UNIQUE(name, city, type)
        );
    """)
    conn.commit()
    conn.close()
    return db


def test_imports_stations_with_stream_url(sample_rr_db, akira_db, monkeypatch):
    """All 4 stations with stream_url should be imported; the dead-radio one skipped."""
    from scripts.media import import_random_radio_global as mod

    monkeypatch.setattr(mod.coverage, "DEFAULT_DB", str(akira_db))

    rc = mod.main(args_override=["--rr-db", str(sample_rr_db)])
    assert rc == 0

    conn = sqlite3.connect(akira_db)
    rows = conn.execute(
        "SELECT name, country, codgl FROM media WHERE type='radio' ORDER BY name"
    ).fetchall()
    conn.close()
    names = [r[0] for r in rows]
    assert "Radio Mitre" in names
    assert "Radio Local" in names
    assert "NPR" in names
    assert "Jovem Pan" in names
    assert "Dead Radio" not in names  # stream_url was NULL


def test_assigns_codgl_for_matched_argentine_city(sample_rr_db, akira_db, monkeypatch):
    """Buenos Aires should match the argentine_towns fixture and get codgl='02000'."""
    from scripts.media import import_random_radio_global as mod

    monkeypatch.setattr(mod.coverage, "DEFAULT_DB", str(akira_db))
    mod.main(args_override=["--rr-db", str(sample_rr_db)])

    conn = sqlite3.connect(akira_db)
    row = conn.execute(
        "SELECT codgl FROM media WHERE name='Radio Mitre'"
    ).fetchone()
    conn.close()
    assert row[0] == "02000"


def test_unmatched_argentine_city_stores_codgl_null(sample_rr_db, akira_db, monkeypatch):
    """Stations in Argentina without a known pueblo get codgl=NULL but still import."""
    from scripts.media import import_random_radio_global as mod

    monkeypatch.setattr(mod.coverage, "DEFAULT_DB", str(akira_db))
    mod.main(args_override=["--rr-db", str(sample_rr_db)])

    conn = sqlite3.connect(akira_db)
    row = conn.execute(
        "SELECT codgl, country FROM media WHERE name='Radio Local'"
    ).fetchone()
    conn.close()
    assert row[0] is None
    assert row[1] == "AR"


def test_non_argentine_stations_have_null_codgl(sample_rr_db, akira_db, monkeypatch):
    """Non-AR stations always have codgl=NULL regardless of city."""
    from scripts.media import import_random_radio_global as mod

    monkeypatch.setattr(mod.coverage, "DEFAULT_DB", str(akira_db))
    mod.main(args_override=["--rr-db", str(sample_rr_db)])

    conn = sqlite3.connect(akira_db)
    rows = conn.execute(
        "SELECT name, codgl, country_code FROM media WHERE country IN ('US','BR')"
    ).fetchall()
    conn.close()
    for name, codgl, code in rows:
        assert codgl is None, f"{name} should have codgl NULL"
        assert code in ("US", "BR")


def test_re_import_is_idempotent(sample_rr_db, akira_db, monkeypatch):
    """Running the import twice should not create duplicate rows."""
    from scripts.media import import_random_radio_global as mod

    monkeypatch.setattr(mod.coverage, "DEFAULT_DB", str(akira_db))
    mod.main(args_override=["--rr-db", str(sample_rr_db)])
    mod.main(args_override=["--rr-db", str(sample_rr_db)])

    conn = sqlite3.connect(akira_db)
    count = conn.execute("SELECT COUNT(*) FROM media").fetchone()[0]
    conn.close()
    assert count == 4, f"Expected 4 unique rows, got {count}"


def test_reset_drops_existing_random_radio_rows(sample_rr_db, akira_db, monkeypatch):
    """--reset should clear all rows with source='random-radio*' before importing."""
    from scripts.media import import_random_radio_global as mod

    monkeypatch.setattr(mod.coverage, "DEFAULT_DB", str(akira_db))

    # First import
    mod.main(args_override=["--rr-db", str(sample_rr_db)])

    # Manually insert a row with source='random-radio' that should be cleared by --reset
    conn = sqlite3.connect(akira_db)
    conn.execute("""
        INSERT INTO media (name, type, city, source, country)
        VALUES ('Stale Station', 'radio', 'Old City', 'random-radio', 'AR')
    """)
    conn.commit()
    conn.close()

    # Reset + reimport
    mod.main(args_override=["--rr-db", str(sample_rr_db), "--reset"])

    conn = sqlite3.connect(akira_db)
    stale = conn.execute(
        "SELECT COUNT(*) FROM media WHERE name='Stale Station'"
    ).fetchone()[0]
    conn.close()
    assert stale == 0, "--reset should have removed the stale row"