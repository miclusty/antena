"""Tests for the AKIRA /medios/radios endpoint."""

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def akira_db_with_radios(tmp_path: Path, monkeypatch) -> Path:
    """Create a minimal AKIRA DB with media rows from 3 countries + 'UN' unknown.

    Patches config.settings.db_path so main.get_db_connection() uses our fixture.
    """
    db = tmp_path / "akira.db"
    conn = sqlite3.connect(db)
    conn.executescript("""
        CREATE TABLE media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            city TEXT NOT NULL,
            province TEXT,
            codgl TEXT,
            website TEXT,
            stream_url TEXT,
            tags TEXT,
            source TEXT NOT NULL,
            country TEXT,
            country_code TEXT,
            language TEXT,
            bitrate TEXT,
            codec TEXT,
            UNIQUE(name, city, type)
        );
        INSERT INTO media (name, type, city, stream_url, source, country) VALUES
            ('Radio AR1', 'radio', 'Buenos Aires', 'https://a', 'random-radio', 'AR'),
            ('Radio AR2', 'radio', 'Córdoba',      'https://b', 'random-radio', 'AR'),
            ('Radio US1', 'radio', 'New York',     'https://c', 'random-radio-global', 'US'),
            ('Radio BR1', 'radio', 'São Paulo',    'https://d', 'random-radio-global', 'BR'),
            ('Radio UN1', 'radio', 'Somewhere',    'https://e', 'random-radio-global', 'UN'),
            ('Diario X',  'diario', 'Buenos Aires', NULL,      'random-radio', 'AR');
    """)
    conn.commit()
    conn.close()

    monkeypatch.setattr("config.settings.db_path", str(db))
    return db


@pytest.fixture
def client(akira_db_with_radios):
    from main import app
    return TestClient(app)


def test_filters_by_country(client):
    r = client.get("/medios/radios?country=US")
    assert r.status_code == 200
    data = r.json()
    names = [it["name"] for it in data["items"]]
    assert names == ["Radio US1"]


def test_returns_only_radios_not_other_types(client):
    r = client.get("/medios/radios?country=AR")
    data = r.json()
    names = [it["name"] for it in data["items"]]
    assert "Diario X" not in names
    assert "Radio AR1" in names
    assert "Radio AR2" in names


def test_no_country_returns_all_except_unknown(client):
    r = client.get("/medios/radios")
    data = r.json()
    names = [it["name"] for it in data["items"]]
    assert len(data["items"]) == 4
    assert "Radio UN1" not in names


def test_pagination_offset_and_limit(client):
    r = client.get("/medios/radios?limit=2&offset=0")
    data = r.json()
    assert len(data["items"]) == 2
    r = client.get("/medios/radios?limit=2&offset=2")
    data = r.json()
    assert len(data["items"]) == 2


def test_response_includes_country_and_country_code(client):
    r = client.get("/medios/radios?country=AR")
    item = r.json()["items"][0]
    assert "country" in item
    assert item["country"] == "AR"


def test_lowercase_country_query_works(client):
    r = client.get("/medios/radios?country=us")
    data = r.json()
    assert len(data["items"]) == 1
    assert data["items"][0]["name"] == "Radio US1"


def test_un_rows_excluded_from_country_specific_query(client):
    r = client.get("/medios/radios?country=UN")
    data = r.json()
    assert data["items"] == []
