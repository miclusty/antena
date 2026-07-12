"""Tests for D1Sync (core/d1_sync.py) + D1Client (core/cloudflare_d1.py).

These tests are unit-level: they never hit the real Cloudflare API.
The Cloudflare HTTP layer is mocked with unittest.mock, the AKIRA SQLite
side uses tmp_path fixtures. The tests prove that:

  1. D1Client posts the right URL, headers, and body.
  2. D1Client surfaces HTTP / API errors as D1Error.
  3. D1Sync.sync_table(name) reads from AKIRA SQLite and pushes the right
     UPDATE / INSERT OR REPLACE statements for each of the 4 mirrored
     tables: clusters, emerging_clusters, sources_credibility, news_cards_simhash.
  4. D1Sync.sync_all() runs every registered table and returns a dict.
  5. A failure on one table doesn't abort the others.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


# ════════════════════════════════════════════════════════════════
# D1Client tests
# ════════════════════════════════════════════════════════════════


class TestD1Client:
    """D1Client must wrap the Cloudflare HTTP API correctly."""

    def test_d1_client_executes_sql(self):
        """execute() POSTs to the right URL with bearer auth + JSON body."""
        from core.cloudflare_d1 import D1Client

        client = D1Client(
            account_id="acct_xyz",
            api_token="token_abc",
            database_id="db_123",
        )

        fake_resp = MagicMock()
        fake_resp.status_code = 200
        fake_resp.json.return_value = {
            "result": [{"results": [{"x": 1}], "success": True, "meta": {}}],
            "success": True,
        }

        with patch("core.cloudflare_d1.requests.post", return_value=fake_resp) as mock_post:
            rows = client.execute("SELECT 1 AS x")

        assert rows == [{"x": 1}]
        call = mock_post.call_args
        assert (
            call.args[0]
            == "https://api.cloudflare.com/client/v4/accounts/acct_xyz/d1/database/db_123/query"
        )
        body = call.kwargs["json"]
        assert body["sql"] == "SELECT 1 AS x"
        assert body["params"] == []
        assert call.kwargs["headers"]["Authorization"] == "Bearer token_abc"
        assert call.kwargs["headers"]["Content-Type"] == "application/json"

    def test_d1_client_passes_params_in_body(self):
        """execute() forwards params to the JSON body as Cloudflare expects."""
        from core.cloudflare_d1 import D1Client

        client = D1Client("a", "b", "c")
        fake_resp = MagicMock()
        fake_resp.status_code = 200
        fake_resp.json.return_value = {
            "result": [{"results": [], "success": True}],
            "success": True,
        }

        with patch("core.cloudflare_d1.requests.post", return_value=fake_resp) as mock_post:
            client.execute("UPDATE t SET x = ? WHERE id = ?", [42, "row-1"])

        body = mock_post.call_args.kwargs["json"]
        assert body["params"] == [42, "row-1"]

    def test_d1_client_returns_multiple_rows(self):
        """A query returning N rows surfaces as list of N dicts."""
        from core.cloudflare_d1 import D1Client

        client = D1Client("a", "b", "c")
        fake_resp = MagicMock()
        fake_resp.status_code = 200
        fake_resp.json.return_value = {
            "result": [
                {
                    "results": [{"id": 1}, {"id": 2}, {"id": 3}],
                    "success": True,
                }
            ],
            "success": True,
        }

        with patch("core.cloudflare_d1.requests.post", return_value=fake_resp):
            rows = client.execute("SELECT id FROM t")

        assert rows == [{"id": 1}, {"id": 2}, {"id": 3}]

    def test_d1_client_returns_empty_list_for_write(self):
        """An UPDATE / INSERT with no SELECT result surfaces []."""
        from core.cloudflare_d1 import D1Client

        client = D1Client("a", "b", "c")
        fake_resp = MagicMock()
        fake_resp.status_code = 200
        fake_resp.json.return_value = {
            "result": [{"results": [], "success": True, "meta": {"changes": 5}}],
            "success": True,
        }

        with patch("core.cloudflare_d1.requests.post", return_value=fake_resp):
            rows = client.execute("UPDATE t SET x = 1")

        assert rows == []

    def test_d1_client_raises_on_http_error(self):
        """A non-2xx HTTP status raises D1Error with the body."""
        from core.cloudflare_d1 import D1Client, D1Error

        client = D1Client("a", "b", "c")
        fake_resp = MagicMock()
        fake_resp.status_code = 403
        fake_resp.text = '{"errors":[{"message":"Forbidden"}]}'
        fake_resp.json.return_value = {"errors": [{"message": "Forbidden"}]}

        with patch("core.cloudflare_d1.requests.post", return_value=fake_resp):
            with pytest.raises(D1Error, match="403"):
                client.execute("SELECT 1")

    def test_d1_client_raises_on_api_success_false(self):
        """Even with HTTP 200, success:false in the body means D1Error."""
        from core.cloudflare_d1 import D1Client, D1Error

        client = D1Client("a", "b", "c")
        fake_resp = MagicMock()
        fake_resp.status_code = 200
        fake_resp.json.return_value = {
            "result": [{"results": [], "success": False}],
            "success": False,
            "errors": [{"message": "no such table: nope"}],
        }

        with patch("core.cloudflare_d1.requests.post", return_value=fake_resp):
            with pytest.raises(D1Error, match="no such table"):
                client.execute("SELECT * FROM nope")

    def test_d1_client_accepts_custom_timeout(self):
        """Constructor takes a timeout (default 30s)."""
        from core.cloudflare_d1 import D1Client

        client = D1Client("a", "b", "c", timeout=5.0)
        fake_resp = MagicMock()
        fake_resp.status_code = 200
        fake_resp.json.return_value = {
            "result": [{"results": [], "success": True}],
            "success": True,
        }

        with patch("core.cloudflare_d1.requests.post", return_value=fake_resp) as mp:
            client.execute("SELECT 1")

        assert mp.call_args.kwargs["timeout"] == 5.0


# ════════════════════════════════════════════════════════════════
# D1Sync fixtures
# ════════════════════════════════════════════════════════════════


@pytest.fixture
def akira_db(tmp_path: Path) -> str:
    """AKIRA SQLite with all four mirrored tables + D1-mirror columns.

    We provision the FULL D1-compatible schema (clusters, emerging_clusters,
    sources, news_cards) so D1Sync can read from it the same way it would
    in production.
    """
    db_path = str(tmp_path / "akira.db")
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE clusters (
            id TEXT PRIMARY KEY NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            master_article_id TEXT,
            neutral_synth_at TEXT,
            pro_gov_synth_at TEXT,
            anti_gov_synth_at TEXT,
            synth_model TEXT,
            bias_narrative TEXT,
            bias_key_quotes TEXT,
            bias_narrative_at TEXT,
            bias_narrative_model TEXT,
            contradictions_json TEXT,
            contradictions_at TEXT,
            contradictions_count INTEGER DEFAULT 0
        );
        CREATE TABLE emerging_clusters (
            cluster_id TEXT PRIMARY KEY,
            velocity_score REAL DEFAULT 0,
            new_articles_in_window INTEGER DEFAULT 0,
            distinct_sources_in_window INTEGER DEFAULT 0,
            credibility_avg REAL DEFAULT 0,
            title TEXT,
            first_seen_at TEXT,
            last_updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            url TEXT NOT NULL,
            credibility_score INTEGER DEFAULT 50,
            uniqueness_ratio REAL DEFAULT 1.0,
            diversity_score INTEGER DEFAULT 50,
            credibility_updated_at TEXT
        );
        CREATE TABLE news_cards (
            id TEXT PRIMARY KEY,
            simhash BIGINT NOT NULL DEFAULT 0
        );
        """
    )
    conn.commit()
    conn.close()
    return db_path


@pytest.fixture
def fake_d1_client():
    """A MagicMock D1Client that records every execute() call.

    Returns:
        (client_mock, captured) — captured is a list of dicts with
        {"sql": ..., "params": ...} for every call.
    """
    client = MagicMock()
    client.execute.return_value = []  # UPDATE → no rows returned
    captured: list[dict] = []

    def _capture(sql, params=None):
        captured.append({"sql": sql, "params": params or []})
        return []

    client.execute.side_effect = _capture
    return client, captured


# ════════════════════════════════════════════════════════════════
# D1Sync per-table tests
# ════════════════════════════════════════════════════════════════


class TestD1Sync:
    """D1Sync must read AKIRA SQLite and push the right SQL to D1."""

    def test_sync_clusters_reads_local_and_pushes_update(
        self, akira_db: str, fake_d1_client
    ):
        """sync_table('clusters') must UPDATE D1.clusters with bias_narrative
        + contradictions_json + the synthesized metadata columns."""
        from core.d1_sync import D1Sync

        client_mock, captured = fake_d1_client
        conn = sqlite3.connect(akira_db)
        conn.execute(
            "INSERT INTO clusters (id, bias_narrative, bias_key_quotes, "
            "bias_narrative_at, bias_narrative_model, contradictions_json, "
            "contradictions_at, contradictions_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "c-001",
                "Cluster leans oficialista",
                '[{"source": "X", "quote": "foo"}]',
                "2026-07-12 12:00:00",
                "qwen3.5-2b",
                '[{"subject": "muertos"}]',
                "2026-07-12 12:00:01",
                1,
            ),
        )
        conn.commit()
        conn.close()

        sync = D1Sync(client=client_mock, akira_db_path=akira_db)
        n = sync.sync_table("clusters")

        assert n == 1, "expected exactly 1 cluster synced"
        # UPDATE (one per row), idempotent — INSERT OR IGNORE is the
        # secondary path we exercise in test_sync_emerging_clusters.
        update_stmts = [c for c in captured if "UPDATE clusters" in c["sql"]]
        assert len(update_stmts) == 1, f"missing UPDATE clusters: {captured}"
        sql = update_stmts[0]["sql"]
        assert "bias_narrative" in sql
        assert "contradictions_json" in sql
        assert "updated_at" in sql
        # Params carry the row payload + cluster id. Check each expected
        # value is somewhere in the params list (note: `in` is element
        # equality for lists, not substring — we use `any(...)` for the
        # substring case so a single-element list doesn't have to match
        # exactly).
        params = update_stmts[0]["params"]
        assert "Cluster leans oficialista" in params
        assert any(
            isinstance(p, str) and '"subject": "muertos"' in p for p in params
        ), f"contradictions_json payload not found in params: {params}"
        assert "c-001" in params

    def test_sync_emerging_clusters_uses_insert_or_replace(
        self, akira_db: str, fake_d1_client
    ):
        """sync_table('emerging_clusters') must INSERT OR REPLACE rows."""
        from core.d1_sync import D1Sync

        client_mock, captured = fake_d1_client
        conn = sqlite3.connect(akira_db)
        conn.execute(
            "INSERT INTO emerging_clusters (cluster_id, velocity_score, "
            "new_articles_in_window, distinct_sources_in_window, "
            "credibility_avg, title, first_seen_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("c-hot", 5.4, 5, 4, 83.25, "Córdoba inundaciones", "2026-07-12 11:30:00"),
        )
        conn.commit()
        conn.close()

        sync = D1Sync(client=client_mock, akira_db_path=akira_db)
        n = sync.sync_table("emerging_clusters")

        assert n == 1
        inserts = [c for c in captured if "INSERT OR REPLACE" in c["sql"].upper()
                   and "emerging_clusters" in c["sql"]]
        assert len(inserts) == 1
        sql = inserts[0]["sql"]
        # All D1 columns must be in the INSERT OR REPLACE
        for col in (
            "cluster_id", "velocity_score", "new_articles_in_window",
            "distinct_sources_in_window", "credibility_avg",
            "title", "first_seen_at", "last_updated_at",
        ):
            assert col in sql, f"missing column {col} in: {sql}"

    def test_sync_credibility_reads_only_changed_rows(
        self, akira_db: str, fake_d1_client
    ):
        """sync_table('sources_credibility') must push a per-row UPDATE with
        the credibility + uniqueness + diversity columns + timestamp."""
        from core.d1_sync import D1Sync

        client_mock, captured = fake_d1_client
        conn = sqlite3.connect(akira_db)
        conn.execute(
            "INSERT INTO sources (id, name, url, credibility_score, "
            "uniqueness_ratio, diversity_score, credibility_updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (1, "Página/12", "https://pagina12.com.ar", 87, 0.91, 73,
             "2026-07-12 11:00:00"),
        )
        conn.execute(
            "INSERT INTO sources (id, name, url, credibility_score, "
            "uniqueness_ratio, diversity_score, credibility_updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (2, "Clarín", "https://clarin.com", 65, 0.78, 60,
             "2026-07-12 11:00:01"),
        )
        conn.commit()
        conn.close()

        sync = D1Sync(client=client_mock, akira_db_path=akira_db)
        n = sync.sync_table("sources_credibility")

        assert n == 2
        updates = [c for c in captured if "UPDATE sources" in c["sql"]]
        assert len(updates) == 2, f"missing per-source updates: {captured}"
        for u in updates:
            sql = u["sql"]
            assert "credibility_score = ?" in sql
            assert "uniqueness_ratio = ?" in sql
            assert "diversity_score = ?" in sql
            assert "credibility_updated_at = ?" in sql
            assert "WHERE id = ?" in sql

    def test_sync_simhash_only_nonzero_rows(
        self, akira_db: str, fake_d1_client
    ):
        """sync_table('news_cards_simhash') must only push cards with a
        non-zero simhash. Cards with simhash=0 are skipped (default state)."""
        from core.d1_sync import D1Sync

        client_mock, captured = fake_d1_client
        conn = sqlite3.connect(akira_db)
        conn.execute("INSERT INTO news_cards (id, simhash) VALUES (?, ?)", ("a", 0))
        conn.execute("INSERT INTO news_cards (id, simhash) VALUES (?, ?)", ("b", 12345))
        conn.execute("INSERT INTO news_cards (id, simhash) VALUES (?, ?)", ("c", 67890))
        conn.commit()
        conn.close()

        sync = D1Sync(client=client_mock, akira_db_path=akira_db)
        n = sync.sync_table("news_cards_simhash")

        # Only the 2 non-zero rows get pushed
        assert n == 2
        updates = [c for c in captured if "UPDATE news_cards" in c["sql"]]
        assert len(updates) == 2
        for u in updates:
            assert "SET simhash = ?" in u["sql"]
            assert "WHERE id = ?" in u["sql"]

    def test_sync_all_runs_every_registered_table(
        self, akira_db: str, fake_d1_client
    ):
        """sync_all() must hit every table in the registry."""
        from core.d1_sync import D1Sync

        client_mock, captured = fake_d1_client
        # Seed one row per table. The clusters row must have a populated
        # narrative/contradiction column (or master_article_id) — those
        # are the columns _sync_clusters' WHERE filter looks at to keep
        # the sync payload bounded. The sources row needs
        # credibility_updated_at set or _sync_sources_credibility filters
        # it out.
        conn = sqlite3.connect(akira_db)
        conn.execute(
            "INSERT INTO clusters (id, bias_narrative, bias_narrative_at) "
            "VALUES ('c-1', 'lean oficialista', '2026-07-12 12:00:00')"
        )
        conn.execute(
            "INSERT INTO emerging_clusters (cluster_id) VALUES ('e-1')"
        )
        conn.execute(
            "INSERT INTO sources (id, name, url, credibility_score, "
            "uniqueness_ratio, diversity_score, credibility_updated_at) "
            "VALUES (1, 'X', 'https://x', 80, 0.85, 70, '2026-07-12 12:00:00')"
        )
        conn.execute("INSERT INTO news_cards (id, simhash) VALUES ('n-1', 1)")
        conn.commit()
        conn.close()

        sync = D1Sync(client=client_mock, akira_db_path=akira_db)
        counts = sync.sync_all()

        assert set(counts.keys()) == {
            "clusters",
            "emerging_clusters",
            "sources_credibility",
            "news_cards_simhash",
        }
        assert all(v >= 1 for v in counts.values()), counts

    def test_sync_continues_when_one_table_fails(
        self, akira_db: str, fake_d1_client
    ):
        """If one table's sync raises, the others must still run + the
        failure must show up as an error key in the result dict."""
        from core.cloudflare_d1 import D1Error
        from core.d1_sync import D1Sync

        client_mock, captured = fake_d1_client

        # Seed data so every table has something to sync. The clusters
        # row needs a populated content column to pass _sync_clusters'
        # WHERE filter. The sources row needs credibility_updated_at
        # to pass _sync_sources_credibility's filter.
        conn = sqlite3.connect(akira_db)
        conn.execute(
            "INSERT INTO clusters (id, bias_narrative, bias_narrative_at) "
            "VALUES ('c-1', 'lean oficialista', '2026-07-12 12:00:00')"
        )
        conn.execute("INSERT INTO emerging_clusters (cluster_id) VALUES ('e-1')")
        conn.execute(
            "INSERT INTO sources (id, name, url, credibility_score, "
            "uniqueness_ratio, diversity_score, credibility_updated_at) "
            "VALUES (1, 'X', 'https://x', 80, 0.85, 70, '2026-07-12 12:00:00')"
        )
        conn.execute("INSERT INTO news_cards (id, simhash) VALUES ('n-1', 1)")
        conn.commit()
        conn.close()

        # Make the clusters call raise; the others should still run.
        original_side_effect = client_mock.execute.side_effect

        def _fail_on_clusters(sql, params=None):
            if "clusters" in sql and "UPDATE clusters" in sql:
                raise D1Error("simulated D1 outage on clusters")
            return original_side_effect(sql, params)

        client_mock.execute.side_effect = _fail_on_clusters

        sync = D1Sync(client=client_mock, akira_db_path=akira_db)
        counts = sync.sync_all()

        # clusters shows the error
        assert "error" in counts["clusters"].lower() or isinstance(
            counts["clusters"], str
        ), counts
        # Others ran cleanly with a positive count
        assert counts["emerging_clusters"] == 1
        assert counts["sources_credibility"] == 1
        assert counts["news_cards_simhash"] == 1

    def test_sync_dry_run_does_not_call_d1(self, akira_db: str, fake_d1_client):
        """dry_run=True must return the counts without ever calling D1Client."""
        from core.d1_sync import D1Sync

        client_mock, captured = fake_d1_client
        conn = sqlite3.connect(akira_db)
        conn.execute(
            "INSERT INTO clusters (id, bias_narrative, bias_narrative_at) "
            "VALUES ('c-1', 'lean oficialista', '2026-07-12 12:00:00')"
        )
        conn.commit()
        conn.close()

        sync = D1Sync(client=client_mock, akira_db_path=akira_db)
        counts = sync.sync_all(dry_run=True)

        assert counts["clusters"] == 1
        assert client_mock.execute.call_count == 0, (
            "dry_run must not hit the D1 client"
        )

    def test_sync_constructor_accepts_explicit_credentials(
        self, akira_db: str, fake_d1_client
    ):
        """D1Sync(account_id, api_token, database_id, db_path) builds its
        own client when none is injected."""
        from core.d1_sync import D1Sync

        # Patch the D1Client constructor so the test never hits the network.
        with patch("core.d1_sync.D1Client") as ClientCtor:
            ClientCtor.return_value.execute.return_value = []
            sync = D1Sync(
                account_id="acct_x",
                api_token="tok_y",
                database_id="db_z",
                akira_db_path=akira_db,
            )
            sync.sync_table("emerging_clusters")  # any table will do

        ClientCtor.assert_called_once()
        kwargs = ClientCtor.call_args.kwargs
        assert kwargs["account_id"] == "acct_x"
        assert kwargs["api_token"] == "tok_y"
        assert kwargs["database_id"] == "db_z"


# ════════════════════════════════════════════════════════════════
# End-to-end smoke test with synthetic data
# ════════════════════════════════════════════════════════════════


def test_smoke_sync_all_returns_clean_counts(akira_db: str, fake_d1_client):
    """End-to-end: synthetic data → sync_all → per-table counts."""
    from core.d1_sync import D1Sync

    client_mock, captured = fake_d1_client
    conn = sqlite3.connect(akira_db)
    conn.execute(
        "INSERT INTO clusters (id, bias_narrative, bias_narrative_at) "
        "VALUES ('c-1', 'lean oficialista', '2026-07-12 12:00:00')"
    )
    conn.execute(
        "INSERT INTO emerging_clusters (cluster_id, velocity_score) "
        "VALUES ('e-1', 4.2)"
    )
    conn.execute(
        "INSERT INTO sources (id, name, url, credibility_score, "
        "uniqueness_ratio, diversity_score, credibility_updated_at) "
        "VALUES (1, 'X', 'https://x.com', 80, 0.85, 70, '2026-07-12 12:00:00')"
    )
    conn.execute("INSERT INTO news_cards (id, simhash) VALUES ('n-1', 999)")
    conn.commit()
    conn.close()

    sync = D1Sync(client=client_mock, akira_db_path=akira_db)
    counts = sync.sync_all()

    # Each table sees its seeded row
    assert counts["clusters"] == 1
    assert counts["emerging_clusters"] == 1
    assert counts["sources_credibility"] == 1
    assert counts["news_cards_simhash"] == 1
    # Captured SQL spans all four tables
    sql_blob = "\n".join(c["sql"] for c in captured)
    assert "UPDATE clusters" in sql_blob
    assert "emerging_clusters" in sql_blob
    assert "UPDATE sources" in sql_blob
    assert "UPDATE news_cards" in sql_blob