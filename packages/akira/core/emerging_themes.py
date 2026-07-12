"""Emerging-theme detection for clusters and sources.

Detects themes that are gaining traction RIGHT NOW — before they
become trending clusters. Two distinct signals are computed from
`news_cards` and `sources`:

1. Cluster velocity (`compute_cluster_velocity`)
   How many distinct sources published articles in a cluster within
   a recent time window. A cluster with 5 articles across 3 sources
   in the last 6 hours is "emerging"; 5 articles from a single source
   is just one outlet chasing a niche.

2. Source burst (`compute_burst_score`)
   Detects sudden extraction-rate spikes from a single source. A
   source that publishes 1 article per day normally but suddenly
   drops 8 in 2 hours is either broke (good) or rate-limited (bad);
   either way it's a signal to surface.

These power:
- API endpoint `GET /api/emerging`  (sorted by velocity_score DESC)
- PM2 cron every 15 min -> `scripts/update_emerging_themes.py`
- Frontend "Tendencias" badge in `TrendingSection.tsx`

No LLM dependency — pure SQL aggregations against the AKIRA
SQLite `news_cards` table.
"""
from __future__ import annotations

import json
import logging
import math
import sqlite3
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Optional

logger = logging.getLogger("akira.emerging_themes")


# ─── Schema detection ─────────────────────────────────────────────
@lru_cache(maxsize=8)
def _news_card_columns(db_path: str) -> frozenset[str]:
    """Return the set of columns that exist on `news_cards`.

    Cached per-path. SQLite caches PRAGMA results internally, but we
    cache in Python to avoid even the small overhead per call.
    """
    try:
        with _connect(db_path) as conn:
            rows = conn.execute("PRAGMA table_info(news_cards)").fetchall()
        return frozenset(r[1] for r in rows)
    except Exception as e:
        logger.warning("could not read news_cards schema: %s", e)
        return frozenset()


def _has_source_id_column(db_path: str) -> bool:
    return "source_id" in _news_card_columns(db_path)


def _has_source_ids_csv(db_path: str) -> bool:
    return "source_ids" in _news_card_columns(db_path)


# ─── Tunables ────────────────────────────────────────────────────
# velocity_score = new_articles × ln(distinct_sources + 1) × (credibility_avg / 100)
#
# Tuning rationale:
# - ln() flattens the source-diversity term so a 3-source cluster
#   doesn't dominate a 5-source one by 60%.
# - credibility_avg / 100 keeps the term in [0, 1]; an unknown source
#   (credibility = 50) effectively halves the score.
# - A threshold of 2.0 needs at least 3 articles from 2 sources of
#   average 78% credibility, OR ~10 articles from 1 decent source.

EMERGING_MIN_SCORE = 2.0          # cutoff for find_emerging_clusters()
EMERGING_MIN_SOURCES = 2          # require ≥ N sources to avoid echo chambers
EMERGING_MIN_ARTICLES = 2         # require ≥ N articles (1-article noise filter)
EXPIRY_HOURS = 24                 # drop emerging rows older than this
BURST_MIN_RATIO = 3.0             # current vs previous window ratio to flag


# ─── Result dataclasses ──────────────────────────────────────────
@dataclass
class VelocitySignal:
    cluster_id: str
    window_hours: int
    new_articles_in_window: int
    distinct_sources_in_window: int
    credibility_avg: float
    velocity_score: float
    is_emerging: bool

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class BurstScore:
    source_id: int
    window_hours: int
    articles_in_window: int
    articles_in_previous_window: int
    burst_score: float              # ratio (in_window / max(prev,1))
    is_bursting: bool

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class EmergingCluster:
    cluster_id: str
    velocity_score: float
    new_articles_in_window: int
    distinct_sources_in_window: int
    credibility_avg: float
    title: Optional[str] = None      # from master_articles.title or top article
    first_seen_at: Optional[str] = None
    last_updated_at: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


# ─── Connection helper (mirrors db.connection.get_db_connection) ─
@contextmanager
def _connect(db_path: str):
    """Open a connection with the same PRAGMAs as get_db_connection(),
    but parameterized — used by tests with a tempfile."""
    conn = sqlite3.connect(db_path, timeout=5)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _window_clause(field: str, hours: int) -> tuple[str, str]:
    """Return (sql_clause, bind_arg). Sign-extended so callers can
    string-concat onto WHERE clauses."""

    arg = f"-{int(hours)} hours"
    clause = f"{field} >= datetime('now', ?)"
    return clause, arg


def _expanded_cte(has_source_id: bool) -> str:
    """Return the SQL fragment for the `_expanded` CTE (without the
    trailing comma) based on which source columns the table has.

    D1 (production API): source_id populated, source_ids may also be
    populated or NULL — prefer source_id when present, fall back to
    source_ids CSV otherwise.

    AKIRA local SQLite: source_id is NULL/absent — must parse
    source_ids CSV via json_each.

    Tests / fixtures: both columns exist (with source_id populated).
    """
    if has_source_id:
        # source_id is the integer; source_ids is the CSV fallback.
        return """
            _expanded AS (
                SELECT nc.id, nc.cluster_id, nc.published_at, nc.is_gacetilla,
                       COALESCE(CAST(je.value AS INTEGER), nc.source_id) AS source_id
                FROM news_cards nc
                LEFT JOIN json_each(
                    '[' || COALESCE(nc.source_ids, '') || ']'
                ) je
            )
        """
    # source_id missing entirely; source_ids CSV is the only signal.
    return """
        _expanded AS (
            SELECT nc.id, nc.cluster_id, nc.published_at, nc.is_gacetilla,
                   CAST(je.value AS INTEGER) AS source_id
            FROM news_cards nc
            INNER JOIN json_each(
                '[' || COALESCE(nc.source_ids, '') || ']'
            ) je
        )
    """


# ─── Velocity ─────────────────────────────────────────────────────
def compute_cluster_velocity(
    cluster_id: str,
    window_hours: int = 6,
    db_path: Optional[str] = None,
) -> VelocitySignal:
    """Compute velocity for a single cluster.

    Measures:
    - articles added to this cluster in the last `window_hours`
    - distinct source_ids among those articles
    - average `credibility_score` of those sources (defaults to 50
      for sources with no credibility row yet)

    Schema-agnostic: works with both D1 (`source_id INTEGER`) and
    AKIRA local SQLite (`source_ids TEXT` CSV). Inspected via
    PRAGMA at first call; the result is cached per `db_path`.

    Returns a VelocitySignal with `velocity_score` and `is_emerging`.
    """
    db_path = db_path or _default_db()
    clause, arg = _window_clause("e.published_at", window_hours)
    cte = _expanded_cte(_has_source_id_column(db_path))
    sql = f"""
        WITH {cte}
        SELECT
            COUNT(DISTINCT e.id) AS new_articles,
            COUNT(DISTINCT e.source_id) AS distinct_sources,
            COALESCE(AVG(COALESCE(s.credibility_score, 50)), 50.0) AS cred_avg
        FROM _expanded e
        LEFT JOIN sources s ON s.id = e.source_id
        WHERE e.cluster_id = ?
          AND e.source_id IS NOT NULL
          AND e.is_gacetilla = 0
          AND {clause}
    """
    with _connect(db_path) as conn:
        row = conn.execute(sql, (cluster_id, arg)).fetchone()

    new_articles = int(row["new_articles"] or 0)
    distinct_sources = int(row["distinct_sources"] or 0)
    cred_avg = float(row["cred_avg"] or 50.0)

    score = _velocity_score(new_articles, distinct_sources, cred_avg)
    is_emerging = (
        score >= EMERGING_MIN_SCORE
        and distinct_sources >= EMERGING_MIN_SOURCES
        and new_articles >= EMERGING_MIN_ARTICLES
    )

    return VelocitySignal(
        cluster_id=cluster_id,
        window_hours=window_hours,
        new_articles_in_window=new_articles,
        distinct_sources_in_window=distinct_sources,
        credibility_avg=cred_avg,
        velocity_score=score,
        is_emerging=is_emerging,
    )


def _velocity_score(articles: int, sources: int, credibility_avg: float) -> float:
    """Pure function for testability.

    Formula: articles × ln(sources + 1) × (credibility_avg / 100)
    """
    if articles <= 0 or sources <= 0:
        return 0.0
    return round(
        articles * math.log(sources + 1) * (credibility_avg / 100.0),
        3,
    )


# ─── Burst ────────────────────────────────────────────────────────
def compute_burst_score(
    source_id: int,
    window_hours: int = 2,
    db_path: Optional[str] = None,
) -> BurstScore:
    """Compare a source's extraction rate in the most recent window vs
    the immediately preceding window of the same length.

    A source that publishes 1 article per day normally but drops 8
    in the last 2 hours has a burst ratio of ~8× (assuming the
    previous 2-hour window had ~1 article too).

    Matches against both `news_cards.source_id = ?` AND
    `source_ids LIKE '%'` pattern (so it catches cards where the
    source appears in the CSV; same card counted once).
    """
    in_window, prev_window = _source_window_counts(source_id, window_hours, db_path)
    ratio = in_window / max(prev_window, 1)
    return BurstScore(
        source_id=source_id,
        window_hours=window_hours,
        articles_in_window=in_window,
        articles_in_previous_window=prev_window,
        burst_score=round(ratio, 3),
        is_bursting=in_window >= 3 and ratio >= BURST_MIN_RATIO,
    )


def _source_window_counts(
    source_id: int,
    window_hours: int,
    db_path: Optional[str],
) -> tuple[int, int]:
    """Return (count in [now - W, now], count in [now - 2W, now - W]).

    Schema-agnostic: matches `source_id = ?` OR the source_id appears
    in the comma-separated `source_ids` text column. Cards are counted
    once (DISTINCT id).
    """
    db_path = db_path or _default_db()
    has_si = _has_source_id_column(db_path)
    end = datetime.now(timezone.utc)
    now_minus_w = (end - timedelta(hours=window_hours)).strftime("%Y-%m-%d %H:%M:%S")
    now_minus_2w = (end - timedelta(hours=window_hours * 2)).strftime("%Y-%m-%d %H:%M:%S")

    if has_si:
        sql = """
            WITH _matched AS (
                SELECT nc.id, nc.published_at
                FROM news_cards nc
                WHERE nc.is_gacetilla = 0
                  AND (
                    nc.source_id = ?
                    OR (
                      nc.source_id IS NULL
                      AND (',' || COALESCE(nc.source_ids, '') || ',') LIKE '%,' || ? || ',%'
                    )
                  )
            )
            SELECT
                SUM(CASE WHEN published_at >= ? THEN 1 ELSE 0 END) AS in_window,
                SUM(CASE WHEN published_at >= ? AND published_at < ? THEN 1 ELSE 0 END) AS prev_window
            FROM _matched
            WHERE published_at >= ?
        """
        params = (
            source_id,
            str(source_id),
            now_minus_w, now_minus_2w, now_minus_w,
            now_minus_2w,
        )
    else:
        # Only source_ids CSV available.
        sql = """
            SELECT
                SUM(CASE WHEN published_at >= ? THEN 1 ELSE 0 END) AS in_window,
                SUM(CASE WHEN published_at >= ? AND published_at < ? THEN 1 ELSE 0 END) AS prev_window
            FROM news_cards
            WHERE is_gacetilla = 0
              AND (',' || COALESCE(source_ids, '') || ',') LIKE '%,' || ? || ',%'
              AND published_at >= ?
        """
        params = (
            now_minus_w, now_minus_2w, now_minus_w,
            str(source_id), now_minus_2w,
        )

    with _connect(db_path) as conn:
        row = conn.execute(sql, params).fetchone()

    return (
        int(row["in_window"] or 0),
        int(row["prev_window"] or 0),
    )


# ─── Find emerging ───────────────────────────────────────────────
def find_emerging_clusters(
    window_hours: int = 6,
    min_score: float = EMERGING_MIN_SCORE,
    limit: int = 20,
    db_path: Optional[str] = None,
) -> list[EmergingCluster]:
    """Return clusters with velocity_score >= min_score, sorted by score DESC.

    Joins against `master_articles` first (preferred title); falls back to
    the most recent article title in the cluster.

    Schema-agnostic: works with `source_id` (D1) and `source_ids`
    CSV (AKIRA local) via the same `_expanded` CTE.
    """
    db_path = db_path or _default_db()
    clause, arg = _window_clause("e.published_at", window_hours)
    cte = _expanded_cte(_has_source_id_column(db_path)).rstrip()
    sql = f"""
        WITH {cte},
        cluster_velocity AS (
            SELECT
                e.cluster_id AS cluster_id,
                COUNT(DISTINCT e.id) AS new_articles,
                COUNT(DISTINCT e.source_id) AS distinct_sources,
                COALESCE(AVG(COALESCE(s.credibility_score, 50)), 50.0) AS cred_avg
            FROM _expanded e
            LEFT JOIN sources s ON s.id = e.source_id
            WHERE e.cluster_id IS NOT NULL
              AND e.source_id IS NOT NULL
              AND e.is_gacetilla = 0
              AND {clause}
            GROUP BY e.cluster_id
            HAVING new_articles >= ?
               AND distinct_sources >= ?
        ),
        cluster_titles AS (
            SELECT cluster_id,
                   MIN(published_at) AS first_seen_at,
                   (SELECT title FROM news_cards WHERE cluster_id = n.cluster_id ORDER BY published_at LIMIT 1) AS title
            FROM news_cards n
            WHERE cluster_id IS NOT NULL AND is_gacetilla = 0
            GROUP BY cluster_id
        )
        SELECT
            cv.cluster_id,
            cv.new_articles,
            cv.distinct_sources,
            cv.cred_avg,
            (cv.new_articles * ln(cv.distinct_sources + 1) * (cv.cred_avg / 100.0)) AS velocity_score,
            COALESCE(ma.title, ct.title) AS title,
            ct.first_seen_at
        FROM cluster_velocity cv
        LEFT JOIN master_articles ma ON ma.cluster_id = cv.cluster_id
        LEFT JOIN cluster_titles ct ON ct.cluster_id = cv.cluster_id
        WHERE (cv.new_articles * ln(cv.distinct_sources + 1) * (cv.cred_avg / 100.0)) >= ?
        ORDER BY velocity_score DESC, cv.new_articles DESC
        LIMIT ?
    """
    with _connect(db_path) as conn:
        rows = conn.execute(
            sql,
            (arg, EMERGING_MIN_ARTICLES, EMERGING_MIN_SOURCES, min_score, limit),
        ).fetchall()

    now = _now_iso()
    return [
        EmergingCluster(
            cluster_id=r["cluster_id"],
            velocity_score=round(float(r["velocity_score"]), 3),
            new_articles_in_window=int(r["new_articles"]),
            distinct_sources_in_window=int(r["distinct_sources"]),
            credibility_avg=round(float(r["cred_avg"]), 2),
            title=r["title"],
            first_seen_at=r["first_seen_at"],
            last_updated_at=now,
        )
        for r in rows
    ]


# ─── Persist to mirror table ─────────────────────────────────────
def upsert_emerging_clusters(
    clusters: Iterable[EmergingCluster],
    db_path: Optional[str] = None,
) -> int:
    """INSERT OR REPLACE rows into the local `emerging_clusters` table.

    Returns the number of rows upserted. Auto-commits; safe to call
    from the PM2 cron script.
    """
    rows = [
        (
            c.cluster_id,
            c.velocity_score,
            c.new_articles_in_window,
            c.distinct_sources_in_window,
            c.credibility_avg,
            c.title,
            c.first_seen_at,
            c.last_updated_at or _now_iso(),
        )
        for c in clusters
    ]
    if not rows:
        return 0

    with _connect(db_path or _default_db()) as conn:
        with conn:
            conn.executemany(
                """INSERT OR REPLACE INTO emerging_clusters
                   (cluster_id, velocity_score, new_articles_in_window,
                    distinct_sources_in_window, credibility_avg,
                    title, first_seen_at, last_updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                rows,
            )
    return len(rows)


def expire_stale_emerging(
    ttl_hours: int = EXPIRY_HOURS,
    db_path: Optional[str] = None,
) -> int:
    """Delete `emerging_clusters` rows whose `last_updated_at` is older
    than `ttl_hours`. Returns the number of rows deleted."""
    with _connect(db_path or _default_db()) as conn:
        with conn:
            cur = conn.execute(
                "DELETE FROM emerging_clusters WHERE last_updated_at < datetime('now', ?)",
                (f"-{ttl_hours} hours",),
            )
            return cur.rowcount or 0


def read_emerging_clusters(
    db_path: Optional[str] = None,
    min_score: float = EMERGING_MIN_SCORE,
    limit: int = 20,
) -> list[dict]:
    """Read the persisted `emerging_clusters` table, sorted by velocity_score DESC.

    Used by the API route — D1 has the same shape and is queried directly
    there; this helper is for local mirror sync verification.
    """
    with _connect(db_path or _default_db()) as conn:
        rows = conn.execute(
            """SELECT cluster_id, velocity_score, new_articles_in_window,
                       distinct_sources_in_window, credibility_avg,
                       title, first_seen_at, last_updated_at
                FROM emerging_clusters
                WHERE velocity_score >= ?
                ORDER BY velocity_score DESC, last_updated_at DESC
                LIMIT ?""",
            (min_score, limit),
        ).fetchall()
    return [dict(r) for r in rows]


# ─── Defaults ───────────────────────────────────────────────────
def _default_db() -> str:
    """Resolve the canonical AKIRA SQLite path.

    Imports lazily to avoid the pydantic-settings bootstrap when
    called from the cron script's argparse path.
    """
    from config import settings
    return settings.db_path


def ensure_table(db_path: Optional[str] = None) -> None:
    """Create the `emerging_clusters` table if it doesn't exist.

    Idempotent — safe to call from any startup path.
    """
    with _connect(db_path or _default_db()) as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS emerging_clusters (
                cluster_id TEXT PRIMARY KEY,
                velocity_score REAL DEFAULT 0,
                new_articles_in_window INTEGER DEFAULT 0,
                distinct_sources_in_window INTEGER DEFAULT 0,
                credibility_avg REAL DEFAULT 0,
                title TEXT,
                first_seen_at TEXT,
                last_updated_at TEXT DEFAULT (datetime('now'))
            )"""
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_emerging_velocity ON emerging_clusters(velocity_score DESC)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_emerging_updated ON emerging_clusters(last_updated_at)"
        )
        conn.commit()
