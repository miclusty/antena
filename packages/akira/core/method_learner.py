"""Method Learner - URL-based extraction method learning system."""

import sqlite3
import json
import logging
import os
from typing import Optional, Dict

logger = logging.getLogger("akira")


class MethodLearner:
    """
    URL-based method learning system.

    Records which extraction method works best for each source URL,
    allowing the engine to optimize cascade order on subsequent fetches.

    Performance impact:
        - First fetch: 3-60s (full cascade)
        - Repeat fetch: 3-15s (starts with best method)
        - Saved: ~50s per source per repeat

    Example:
        URL https://infotuc.com.ar/feed/ fails with RSS but succeeds with WP API.
        Learner records: last_success_method = "wp_api"
        Next fetch starts with wp_api instead of rss.
    """

    def __init__(self, db_path: str):
        """
        Initialize learner with SQLite database.

        Args:
            db_path: Path to akira.db
        """
        self.db_path = db_path

        # Ensure directory exists
        os.makedirs(os.path.dirname(db_path), exist_ok=True)

        # Connect and initialize schema
        self.db = sqlite3.connect(db_path, timeout=300)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA busy_timeout=120000")
        try:
            self.db.row_factory = sqlite3.Row
            self._init_schema()
        except Exception:
            self.db.close()
            raise

        logger.info(f"method_learner_initialized db={db_path}")

    def _init_schema(self):
        """Initialize source_health and extraction_stats tables."""
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS source_health (
                source_id INTEGER PRIMARY KEY,
                url TEXT UNIQUE,
                last_success_method TEXT,
                success_count TEXT DEFAULT '{}',
                consecutive_failures INTEGER DEFAULT 0,
                is_circuit_open INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        self.db.execute("""
            CREATE TABLE IF NOT EXISTS extraction_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT,
                method TEXT,
                duration_ms INTEGER,
                items_count INTEGER,
                success INTEGER,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        self.db.commit()
        logger.info("method_learner_schema_initialized")

    def get_best_method(self, url: str) -> Optional[str]:
        """
        Get historically best method for this URL.

        Returns:
            Method name (e.g., "rss") if found and not circuit-opened
            None if no history or circuit is open (consecutive_failures >= 5)

        Example:
            >>> learner.get_best_method("https://infotuc.com.ar/feed/")
            "rss"  # Last successful method
        """
        row = self.db.execute(
            "SELECT last_success_method, consecutive_failures FROM source_health WHERE url = ?",
            (url,),
        ).fetchone()

        if not row:
            return None

        # Circuit breaker: if 5+ consecutive failures, ignore history
        if row["consecutive_failures"] >= 5:
            logger.warning(
                f"method_learner_circuit_open url={url} failures={row['consecutive_failures']}"
            )
            return None

        return row["last_success_method"]

    def record_success(self, url: str, method: str, duration_ms: int, items_count: int):
        """
        Record successful extraction.

        Updates:
            - last_success_method
            - success_count JSON (increment method count)
            - consecutive_failures = 0
            - extraction_stats log

        Args:
            url: Source URL
            method: Extraction method (rss, wp_api, newspaper, etc.)
            duration_ms: Extraction duration in milliseconds
            items_count: Number of items extracted
        """
        # Get current success counts
        row = self.db.execute(
            "SELECT success_count FROM source_health WHERE url = ?", (url,)
        ).fetchone()

        success_counts = {}
        if row:
            success_counts = json.loads(row["success_count"] or "{}")

        # Increment method count
        success_counts[method] = success_counts.get(method, 0) + 1

        # Update or insert
        existing = self.db.execute(
            "SELECT url FROM source_health WHERE url = ?", (url,)
        ).fetchone()

        if existing:
            self.db.execute(
                """
                UPDATE source_health 
                SET last_success_method = ?,
                    success_count = ?,
                    consecutive_failures = 0,
                    is_circuit_open = 0,
                    updated_at = datetime('now')
                WHERE url = ?
            """,
                (method, json.dumps(success_counts), url),
            )
        else:
            self.db.execute(
                """
                INSERT INTO source_health (url, last_success_method, success_count, consecutive_failures)
                VALUES (?, ?, ?, 0)
            """,
                (url, method, json.dumps(success_counts)),
            )

        # Log to extraction_stats
        self.db.execute(
            """
            INSERT INTO extraction_stats (url, method, duration_ms, items_count, success)
            VALUES (?, ?, ?, ?, 1)
        """,
            (url, method, duration_ms, items_count),
        )

        self.db.commit()

        logger.info(
            f"method_learner_success url={url} method={method} "
            f"duration={duration_ms}ms items={items_count}"
        )

    def record_failure(self, url: str, method: str, duration_ms: int, error: str):
        """
        Record failed extraction.

        Updates:
            - consecutive_failures += 1
            - is_circuit_open = 1 if consecutive_failures >= 5
            - extraction_stats log

        Args:
            url: Source URL
            method: Extraction method
            duration_ms: Extraction duration before failure
            error: Error message
        """
        existing = self.db.execute(
            "SELECT consecutive_failures FROM source_health WHERE url = ?", (url,)
        ).fetchone()

        if existing:
            new_failures = existing["consecutive_failures"] + 1
            circuit_open = 1 if new_failures >= 5 else 0

            self.db.execute(
                """
                UPDATE source_health 
                SET consecutive_failures = ?,
                    is_circuit_open = ?,
                    updated_at = datetime('now')
                WHERE url = ?
            """,
                (new_failures, circuit_open, url),
            )
        else:
            self.db.execute(
                """
                INSERT INTO source_health (url, consecutive_failures, is_circuit_open)
                VALUES (?, 1, 0)
            """,
                (url,),
            )

        # Log to extraction_stats
        self.db.execute(
            """
            INSERT INTO extraction_stats (url, method, duration_ms, items_count, success)
            VALUES (?, ?, ?, 0, 0)
        """,
            (url, method, duration_ms),
        )

        self.db.commit()

        logger.warning(
            f"method_learner_failure url={url} method={method} "
            f"duration={duration_ms}ms error={error}"
        )

    def get_stats(self) -> Dict:
        """
        Get overall learning statistics.

        Returns:
            Dict with:
                - total_sources_tracked
                - circuit_open_sources
                - method_distribution (counts per method)
        """
        total_sources = self.db.execute(
            "SELECT COUNT(*) as count FROM source_health"
        ).fetchone()["count"]

        circuit_open_sources = self.db.execute(
            "SELECT COUNT(*) as count FROM source_health WHERE is_circuit_open = 1"
        ).fetchone()["count"]

        method_distribution = {}
        rows = self.db.execute(
            "SELECT last_success_method, COUNT(*) as count FROM source_health WHERE last_success_method IS NOT NULL GROUP BY last_success_method"
        ).fetchall()

        for row in rows:
            method_distribution[row["last_success_method"]] = row["count"]

        return {
            "total_sources_tracked": total_sources,
            "circuit_open_sources": circuit_open_sources,
            "method_distribution": method_distribution,
        }

    def reset_learning(self, url: Optional[str] = None):
        """
        Reset learning for specific URL or all URLs.

        Args:
            url: Optional URL to reset. If None, reset all.
        """
        if url:
            self.db.execute("DELETE FROM source_health WHERE url = ?", (url,))
            self.db.execute("DELETE FROM extraction_stats WHERE url = ?", (url,))
            logger.info(f"method_learner_reset url={url}")
        else:
            self.db.execute("DELETE FROM source_health")
            self.db.execute("DELETE FROM extraction_stats")
            logger.info("method_learner_reset_all")

        self.db.commit()

    def cleanup_extraction_stats(self, days: int = 30) -> int:
        """
        Remove extraction_stats entries older than N days to prevent unbounded growth.

        Args:
            days: Delete entries older than this many days (default 30)

        Returns:
            Number of entries deleted
        """
        cursor = self.db.execute(
            "DELETE FROM extraction_stats WHERE timestamp < datetime('now', '-' || ? || ' days')",
            (days,),
        )
        self.db.commit()
        deleted = cursor.rowcount
        if deleted:
            logger.info(
                f"extraction_stats_cleanup deleted={deleted} older_than={days}d"
            )
        return deleted

    def cleanup_stale_health_entries(self, days: int = 7) -> int:
        """
        Remove source_health entries with no recent activity.

        Args:
            days: Delete entries with last_updated older than this many days

        Returns:
            Number of entries deleted
        """
        cursor = self.db.execute(
            "DELETE FROM source_health WHERE last_updated < datetime('now', '-' || ? || ' days')",
            (days,),
        )
        self.db.commit()
        deleted = cursor.rowcount
        if deleted:
            logger.info(f"source_health_cleanup deleted={deleted} older_than={days}d")
        return deleted

    def close(self):
        """Close database connection."""
        self.db.close()
        logger.info("method_learner_closed")
