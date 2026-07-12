"""Tests for emerging_themes module.

All tests use a temp SQLite file so they're fully isolated from the
production `data/akira.db`. Each test seeds `news_cards` + `sources`
directly so we can simulate any time-window scenario.
"""
import math
import os
import sqlite3
import tempfile
from datetime import datetime, timedelta, timezone
from typing import Optional

import pytest

from core.emerging_themes import (
    EMERGING_MIN_SCORE,
    EMERGING_MIN_SOURCES,
    EMERGING_MIN_ARTICLES,
    BurstScore,
    EmergingCluster,
    VelocitySignal,
    _velocity_score,
    compute_burst_score,
    compute_cluster_velocity,
    ensure_table,
    expire_stale_emerging,
    find_emerging_clusters,
    read_emerging_clusters,
    upsert_emerging_clusters,
)


# ─── Fixtures ─────────────────────────────────────────────────────
@pytest.fixture
def db_path():
    """Create a temp SQLite file with the tables emerging_themes needs."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE sources (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            url TEXT,
            credibility_score INTEGER DEFAULT 50,
            is_active INTEGER DEFAULT 1
        );
        CREATE TABLE news_cards (
            id TEXT PRIMARY KEY,
            cluster_id TEXT,
            source_id INTEGER,
            source_ids TEXT,
            title TEXT,
            summary TEXT,
            body TEXT,
            is_gacetilla INTEGER DEFAULT 0,
            published_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE master_articles (
            id TEXT PRIMARY KEY,
            cluster_id TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
    """)
    conn.commit()
    conn.close()
    ensure_table(path)
    yield path
    os.unlink(path)


def _iso(dt: datetime) -> str:
    """Format a datetime as SQLite CURRENT_TIMESTAMP-compatible string."""
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _insert_source(conn, sid: int, name: str, credibility: int = 50) -> None:
    conn.execute(
        "INSERT INTO sources (id, name, url, credibility_score) VALUES (?, ?, ?, ?)",
        (sid, name, f"https://{name.lower().replace(' ', '')}.example", credibility),
    )


def _insert_card(
    conn,
    card_id: str,
    cluster_id: str,
    source_id: Optional[int],
    published_at: datetime,
    title: str = "Title",
    is_gacetilla: int = 0,
) -> None:
    # Mirror production: source_id populated when resolved (D1),
    # source_ids CSV populated for local SQLite. We populate BOTH
    # to test the COALESCE(json_each, source_id) path. The
    # implementation should pick source_id when available (no
    # duplication) — so we set source_ids = '' here.
    conn.execute(
        "INSERT INTO news_cards (id, cluster_id, source_id, source_ids, title, summary, is_gacetilla, published_at, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (card_id, cluster_id, source_id, "", title, "summary", is_gacetilla, _iso(published_at), _iso(published_at)),
    )


def _insert_master(conn, cluster_id: str, title: str) -> None:
    conn.execute(
        "INSERT INTO master_articles (id, cluster_id, title, summary) VALUES (?, ?, ?, ?)",
        (f"master-{cluster_id}", cluster_id, title, "master summary"),
    )


# ─── _velocity_score (pure function) ─────────────────────────────
class TestVelocityScorePure:
    def test_zero_articles_returns_zero(self):
        assert _velocity_score(0, 3, 80.0) == 0.0

    def test_zero_sources_returns_zero(self):
        assert _velocity_score(5, 0, 80.0) == 0.0

    def test_single_source_low_score(self):
        # 5 articles × ln(2) × 0.5 = ~1.73 — below default threshold (2.0)
        score = _velocity_score(5, 1, 50.0)
        assert 1.5 < score < 2.0

    def test_three_sources_high_credibility_passes_threshold(self):
        # 5 × ln(4) × 0.78 = 5.4 — above default threshold
        score = _velocity_score(5, 3, 78.0)
        assert score >= EMERGING_MIN_SCORE

    def test_formula_matches_documented(self):
        # Spec: new_articles × ln(distinct_sources + 1) × (credibility_avg / 100)
        # Note: score uses +1 inside ln to handle 1-source case where ln(1)=0.
        score = _velocity_score(10, 4, 80.0)
        expected = 10 * math.log(5) * 0.80
        assert abs(score - round(expected, 3)) < 0.01


# ─── compute_cluster_velocity ─────────────────────────────────────
class TestComputeClusterVelocity:
    def test_recent_three_source_cluster_is_emerging(self, db_path):
        now = _now()
        conn = sqlite3.connect(db_path)
        try:
            _insert_source(conn, 1, "Clarín", 60)
            _insert_source(conn, 2, "Página/12", 80)
            _insert_source(conn, 3, "La Nación", 75)
            for i in range(5):
                _insert_card(
                    conn, f"c{i}", "c-xyz", (i % 3) + 1,
                    now - timedelta(hours=i), title=f"Córdoba inundaciones #{i}",
                )
            conn.commit()
        finally:
            conn.close()

        sig = compute_cluster_velocity("c-xyz", window_hours=6, db_path=db_path)
        assert isinstance(sig, VelocitySignal)
        assert sig.cluster_id == "c-xyz"
        assert sig.window_hours == 6
        assert sig.new_articles_in_window == 5
        assert sig.distinct_sources_in_window == 3
        assert 70.0 <= sig.credibility_avg <= 73.0        # avg of 60, 80, 75
        assert sig.is_emerging is True
        assert sig.velocity_score >= EMERGING_MIN_SCORE

    def test_old_articles_only_not_emerging(self, db_path):
        """Cluster with 5 articles all from 12h+ ago — outside the window."""
        now = _now()
        conn = sqlite3.connect(db_path)
        try:
            _insert_source(conn, 1, "A", 80)
            _insert_source(conn, 2, "B", 80)
            for i in range(5):
                _insert_card(
                    conn, f"c{i}", "c-old",
                    (i % 2) + 1,
                    now - timedelta(hours=12 + i),  # all older than 6h window
                )
            conn.commit()
        finally:
            conn.close()

        sig = compute_cluster_velocity("c-old", window_hours=6, db_path=db_path)
        assert sig.new_articles_in_window == 0
        assert sig.velocity_score == 0.0
        assert sig.is_emerging is False

    def test_single_source_cluster_fails_min_sources(self, db_path):
        """Single-source cluster should NOT be flagged even with many articles."""
        now = _now()
        conn = sqlite3.connect(db_path)
        try:
            _insert_source(conn, 1, "OnlySource", 95)
            for i in range(10):
                _insert_card(conn, f"c{i}", "c-solo", 1, now - timedelta(minutes=i * 30))
            conn.commit()
        finally:
            conn.close()

        sig = compute_cluster_velocity("c-solo", window_hours=6, db_path=db_path)
        assert sig.new_articles_in_window == 10
        assert sig.distinct_sources_in_window == 1
        # Score may be high but is_emerging is False because of source floor.
        assert sig.is_emerging is False

    def test_gacetillas_excluded(self, db_path):
        """Paid content (gacetillas) inflates volume without editorial value."""
        now = _now()
        conn = sqlite3.connect(db_path)
        try:
            _insert_source(conn, 1, "RealSource", 80)
            _insert_source(conn, 2, "RealSource2", 80)
            # 6 gacetillas + 1 real
            _insert_card(conn, "g1", "c-gac", 1, now, is_gacetilla=1)
            _insert_card(conn, "g2", "c-gac", 1, published_at=now, is_gacetilla=1)
            _insert_card(conn, "g3", "c-gac", 2, published_at=now, is_gacetilla=1)
            _insert_card(conn, "g4", "c-gac", 1, published_at=now, is_gacetilla=1)
            _insert_card(conn, "g5", "c-gac", 2, published_at=now, is_gacetilla=1)
            _insert_card(conn, "g6", "c-gac", 1, published_at=now, is_gacetilla=1)
            _insert_card(conn, "real", "c-gac", 1, published_at=now)
            conn.commit()
        finally:
            conn.close()

        sig = compute_cluster_velocity("c-gac", window_hours=6, db_path=db_path)
        assert sig.new_articles_in_window == 1        # only the real one
        assert sig.is_emerging is False

    def test_unknown_cluster_returns_zeros(self, db_path):
        sig = compute_cluster_velocity("c-does-not-exist", db_path=db_path)
        assert sig.new_articles_in_window == 0
        assert sig.distinct_sources_in_window == 0
        assert sig.velocity_score == 0.0
        assert sig.is_emerging is False

    def test_null_source_id_excluded(self, db_path):
        """Cards without a resolved source_id should NOT count toward velocity."""
        now = _now()
        conn = sqlite3.connect(db_path)
        try:
            _insert_source(conn, 1, "A", 80)
            _insert_source(conn, 2, "B", 80)
            _insert_card(conn, "c1", "c-null", 1, now)
            _insert_card(conn, "c2", "c-null", 2, now)
            _insert_card(conn, "c3", "c-null", None, now)        # source unknown
            _insert_card(conn, "c4", "c-null", None, now)
            # Mark these two as "source unresolved" in the DB to match production.
            conn.execute(
                "UPDATE news_cards SET source_id = NULL WHERE id IN ('c3', 'c4')"
            )
            conn.commit()
        finally:
            conn.close()

        sig = compute_cluster_velocity("c-null", window_hours=6, db_path=db_path)
        assert sig.new_articles_in_window == 2        # only resolved ones
        assert sig.distinct_sources_in_window == 2


# ─── compute_burst_score ──────────────────────────────────────────
class TestComputeBurstScore:
    def test_steady_source_low_burst(self, db_path):
        now = _now()
        conn = sqlite3.connect(db_path)
        try:
            _insert_source(conn, 1, "Steady", 70)
            for h in range(48):
                _insert_card(
                    conn, f"c{h}", "c-steady", 1,
                    now - timedelta(hours=h + 0.5),
                )
            conn.commit()
        finally:
            conn.close()

        burst = compute_burst_score(1, window_hours=2, db_path=db_path)
        assert isinstance(burst, BurstScore)
        # Roughly equal in both windows → ratio near 1
        assert 0.5 <= burst.burst_score <= 1.5
        assert burst.is_bursting is False

    def test_spike_source_is_bursting(self, db_path):
        """9 articles in last 2h, 1 article in 2h before that → burst."""
        now = _now()
        conn = sqlite3.connect(db_path)
        try:
            _insert_source(conn, 1, "Spike", 70)
            for i in range(9):
                _insert_card(conn, f"c{i}", "c-burst", 1, now - timedelta(minutes=i * 10))
            # one article 3h ago (in prev window, not current)
            _insert_card(conn, "cold", "c-burst", 1, now - timedelta(hours=3))
            conn.commit()
        finally:
            conn.close()

        burst = compute_burst_score(1, window_hours=2, db_path=db_path)
        assert burst.articles_in_window == 9
        assert burst.articles_in_previous_window == 1
        assert burst.burst_score >= 3.0
        assert burst.is_bursting is True

    def test_minimal_activity_not_bursting(self, db_path):
        """A single recent article should NOT trigger burst (< 3 articles)."""
        now = _now()
        conn = sqlite3.connect(db_path)
        try:
            _insert_source(conn, 1, "Quiet", 70)
            _insert_card(conn, "only", "c-q", 1, now - timedelta(minutes=10))
            conn.commit()
        finally:
            conn.close()

        burst = compute_burst_score(1, window_hours=2, db_path=db_path)
        assert burst.articles_in_window == 1
        assert burst.is_bursting is False


# ─── find_emerging_clusters ───────────────────────────────────────
class TestFindEmergingClusters:
    def test_returns_sorted_by_velocity_desc(self, db_path):
        now = _now()
        conn = sqlite3.connect(db_path)
        try:
            # Cluster A's sources: S1(55), S2(60), S3(65), S4(70) — avg 62.5
            _insert_source(conn, 1, "S1", 55)
            _insert_source(conn, 2, "S2", 60)
            # Cluster B's sources: S3(65), S5(85) — avg 75
            _insert_source(conn, 3, "S3", 65)
            _insert_source(conn, 4, "S4", 70)
            _insert_source(conn, 5, "S5", 85)
            # Cluster A: 8 articles from 4 sources
            for i in range(8):
                _insert_card(conn, f"a{i}", "c-A", (i % 4) + 1, now - timedelta(minutes=i * 30))
            # Cluster B: 5 articles from 2 sources, higher credibility
            for i in range(5):
                _insert_card(conn, f"b{i}", "c-B", [3, 5][i % 2], now - timedelta(minutes=i * 30))
            conn.commit()
        finally:
            conn.close()

        emerging = find_emerging_clusters(window_hours=6, db_path=db_path)
        # Both should be above threshold; A should sort first.
        ids = [c.cluster_id for c in emerging]
        assert "c-A" in ids
        assert "c-B" in ids
        assert ids.index("c-A") < ids.index("c-B")
        assert emerging[0].velocity_score >= emerging[1].velocity_score

    def test_excludes_stale_clusters(self, db_path):
        """A cluster with old articles only should NOT appear."""
        now = _now()
        conn = sqlite3.connect(db_path)
        try:
            _insert_source(conn, 1, "A", 80)
            _insert_source(conn, 2, "B", 80)
            # All 10+ hours old
            for i in range(5):
                _insert_card(conn, f"old{i}", "c-old", (i % 2) + 1, now - timedelta(hours=12 + i))
            conn.commit()
        finally:
            conn.close()

        emerging = find_emerging_clusters(window_hours=6, db_path=db_path)
        assert all(c.cluster_id != "c-old" for c in emerging)

    def test_min_score_filter(self, db_path):
        now = _now()
        conn = sqlite3.connect(db_path)
        try:
            # 3 sources high credibility
            for sid in range(1, 4):
                _insert_source(conn, sid, f"S{sid}", 90)
            # 5 articles in last 6h → score ~ 5 × ln(4) × 0.90 = ~6.24
            for i in range(5):
                _insert_card(conn, f"hi{i}", "c-hi", (i % 3) + 1, now - timedelta(hours=i))
            conn.commit()
        finally:
            conn.close()

        # High threshold should still find it
        hi = find_emerging_clusters(min_score=5.0, db_path=db_path)
        assert any(c.cluster_id == "c-hi" for c in hi)

        # Higher threshold should exclude it
        none = find_emerging_clusters(min_score=1000.0, db_path=db_path)
        assert not any(c.cluster_id == "c-hi" for c in none)

    def test_title_from_master_articles_preferred(self, db_path):
        now = _now()
        conn = sqlite3.connect(db_path)
        try:
            _insert_source(conn, 1, "A", 80)
            _insert_source(conn, 2, "B", 80)
            _insert_master(conn, "c-titled", "Córdoba inundaciones: balance oficial")
            _insert_card(conn, "c1", "c-titled", 1, now, title="raw title 1")
            _insert_card(conn, "c2", "c-titled", 2, now, title="raw title 2")
            _insert_card(conn, "c3", "c-titled", 1, now, title="raw title 3")
            conn.commit()
        finally:
            conn.close()

        emerging = find_emerging_clusters(min_score=0.0, db_path=db_path)
        cluster = next((c for c in emerging if c.cluster_id == "c-titled"), None)
        assert cluster is not None
        assert cluster.title == "Córdoba inundaciones: balance oficial"

    def test_title_falls_back_to_news_card(self, db_path):
        """If no master_article exists, use any recent card title."""
        now = _now()
        conn = sqlite3.connect(db_path)
        try:
            _insert_source(conn, 1, "A", 80)
            _insert_source(conn, 2, "B", 80)
            _insert_card(conn, "c1", "c-fb", 1, now, title="Top article title")
            _insert_card(conn, "c2", "c-fb", 2, now, title="Other title")
            conn.commit()
        finally:
            conn.close()

        emerging = find_emerging_clusters(min_score=0.0, db_path=db_path)
        cluster = next(c for c in emerging if c.cluster_id == "c-fb")
        assert cluster.title is not None
        assert cluster.title in ("Top article title", "Other title")

    def test_respects_limit(self, db_path):
        now = _now()
        conn = sqlite3.connect(db_path)
        try:
            _insert_source(conn, 1, "A", 90)
            _insert_source(conn, 2, "B", 90)
            for i in range(5):
                cluster = f"c-{i}"
                for j in range(3):
                    _insert_card(conn, f"{cluster}-{j}", cluster, (j % 2) + 1, now - timedelta(hours=j))
            conn.commit()
        finally:
            conn.close()

        emerging = find_emerging_clusters(min_score=0.0, limit=3, db_path=db_path)
        assert len(emerging) <= 3


# ─── Persistence + expiry ────────────────────────────────────────
class TestPersistence:
    def test_upsert_and_read_roundtrip(self, db_path):
        now = _now()
        conn = sqlite3.connect(db_path)
        try:
            _insert_source(conn, 1, "A", 80)
            _insert_source(conn, 2, "B", 80)
            for i in range(3):
                _insert_card(conn, f"c{i}", "c-rt", (i % 2) + 1, now - timedelta(hours=i))
            conn.commit()
        finally:
            conn.close()

        clusters = find_emerging_clusters(min_score=0.0, db_path=db_path)
        assert any(c.cluster_id == "c-rt" for c in clusters)
        target = next(c for c in clusters if c.cluster_id == "c-rt")

        # Upsert
        written = upsert_emerging_clusters([target], db_path=db_path)
        assert written == 1

        # Read back
        rows = read_emerging_clusters(db_path=db_path)
        assert len(rows) == 1
        assert rows[0]["cluster_id"] == "c-rt"
        assert rows[0]["velocity_score"] == target.velocity_score

    def test_upsert_idempotent_overwrites(self, db_path):
        now = _now()
        conn = sqlite3.connect(db_path)
        try:
            _insert_source(conn, 1, "A", 80)
            _insert_source(conn, 2, "B", 80)
            for i in range(3):
                _insert_card(conn, f"c{i}", "c-idem", (i % 2) + 1, now - timedelta(hours=i))
            conn.commit()
        finally:
            conn.close()

        target = EmergingCluster(
            cluster_id="c-idem",
            velocity_score=5.5,
            new_articles_in_window=3,
            distinct_sources_in_window=2,
            credibility_avg=80.0,
            title="Test",
            first_seen_at=_iso(now),
            last_updated_at=_iso(now),
        )
        upsert_emerging_clusters([target], db_path=db_path)
        upsert_emerging_clusters([target], db_path=db_path)        # second call

        rows = read_emerging_clusters(db_path=db_path)
        assert len(rows) == 1
        assert rows[0]["velocity_score"] == 5.5

    def test_expire_stale_drops_old_rows(self, db_path):
        # Two rows: one fresh, one 30h old
        conn = sqlite3.connect(db_path)
        fresh_ts = _iso(_now())
        old_ts = _iso(_now() - timedelta(hours=30))
        try:
            conn.executemany(
                "INSERT INTO emerging_clusters (cluster_id, velocity_score, last_updated_at) VALUES (?, ?, ?)",
                [
                    ("c-fresh", 4.0, fresh_ts),
                    ("c-old", 4.0, old_ts),
                ],
            )
            conn.commit()
        finally:
            conn.close()

        dropped = expire_stale_emerging(ttl_hours=24, db_path=db_path)
        assert dropped == 1
        rows = read_emerging_clusters(db_path=db_path, min_score=0.0)
        ids = [r["cluster_id"] for r in rows]
        assert "c-fresh" in ids
        assert "c-old" not in ids


# ─── Edge cases ─────────────────────────────────────────────────
class TestEdgeCases:
    def test_very_recent_cluster_first_seen_set(self, db_path):
        """A cluster with all articles in the last 5 minutes is recent."""
        now = _now()
        conn = sqlite3.connect(db_path)
        try:
            _insert_source(conn, 1, "A", 80)
            _insert_source(conn, 2, "B", 80)
            for i in range(3):
                _insert_card(conn, f"c{i}", "c-new", (i % 2) + 1, now - timedelta(minutes=i * 5))
            conn.commit()
        finally:
            conn.close()

        emerging = find_emerging_clusters(min_score=0.0, db_path=db_path)
        cluster = next(c for c in emerging if c.cluster_id == "c-new")
        assert cluster.first_seen_at is not None

    def test_empty_db_returns_empty_list(self, db_path):
        assert find_emerging_clusters(db_path=db_path) == []
        assert read_emerging_clusters(db_path=db_path) == []
