"""Method Scorer - Weighted scoring for extraction methods."""

import logging
from dataclasses import dataclass
from typing import Optional, List
from datetime import datetime

from core.db_helpers import get_db_connection

logger = logging.getLogger("akira")


@dataclass
class MethodScore:
    """Score for a method on a specific URL."""

    url: str
    method: str
    success_rate: float
    avg_duration: float
    speed_score: float
    score: float
    attempts: int = 0


class MethodScorer:
    """
    Weighted scoring system for extraction methods.

    Score = (success_rate * 0.6) + (speed_score * 0.4)

    success_rate = successes / total_attempts
    speed_score = max(0, 1 - (avg_duration / 60000))

    Tracks performance by hour for time-based optimization.
    """

    def __init__(self, db_path: str):
        """
        Initialize with database path.

        Args:
            db_path: Path to akira.db
        """
        self.db_path = db_path
        self._init_schema()

        logger.info(f"method_scorer_initialized db={db_path}")

    def _init_schema(self):
        """Create method_history table."""
        with get_db_connection(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS method_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    url TEXT NOT NULL,
                    method TEXT NOT NULL,
                    duration_ms INTEGER NOT NULL,
                    success INTEGER NOT NULL,
                    hour_of_day INTEGER NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_method_history_url 
                ON method_history(url, hour_of_day)
            """)

            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_method_history_method 
                ON method_history(method)
            """)

            conn.commit()

    def record_attempt(
        self,
        url: str,
        method: str,
        duration_ms: int,
        success: bool,
        hour: Optional[int] = None,
    ):
        """
        Record a method attempt.

        Args:
            url: Source URL
            method: Method name (rss, wp_api, etc.)
            duration_ms: Duration in milliseconds
            success: Whether extraction succeeded
            hour: Hour of day (0-23), defaults to current hour
        """
        if hour is None:
            hour = datetime.now().hour

        with get_db_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO method_history (url, method, duration_ms, success, hour_of_day)
                VALUES (?, ?, ?, ?, ?)
            """,
                (url, method, duration_ms, 1 if success else 0, hour),
            )

            conn.commit()

    def _compute_scores(self, rows, url: str) -> List[MethodScore]:
        """Compute scores from query results."""
        scores = []
        for row in rows:
            success_rate = (
                row["successes"] / row["attempts"] if row["attempts"] > 0 else 0
            )
            speed_score = max(0, 1 - (row["avg_duration"] / 60000))
            score = (success_rate * 0.6) + (speed_score * 0.4)

            scores.append(
                MethodScore(
                    url=url,
                    method=row["method"],
                    success_rate=round(success_rate, 3),
                    avg_duration=round(row["avg_duration"], 1),
                    speed_score=round(speed_score, 3),
                    score=round(score, 3),
                    attempts=row["attempts"],
                )
            )

        return sorted(scores, key=lambda s: s.score, reverse=True)

    def get_scores_for_url(self, url: str) -> List[MethodScore]:
        """
        Get method scores for a specific URL.

        Args:
            url: Source URL

        Returns:
            List of MethodScore sorted by score descending
        """
        with get_db_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT method,
                       COUNT(*) as attempts,
                       SUM(success) as successes,
                       AVG(duration_ms) as avg_duration
                FROM method_history
                WHERE url = ?
                GROUP BY method
            """,
                (url,),
            ).fetchall()

            return self._compute_scores(rows, url)

    def get_scores_for_hour(self, url: str, hour: int) -> List[MethodScore]:
        """
        Get method scores for a URL at a specific hour.

        Args:
            url: Source URL
            hour: Hour of day (0-23)

        Returns:
            List of MethodScore sorted by score descending
        """
        with get_db_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT method,
                       COUNT(*) as attempts,
                       SUM(success) as successes,
                       AVG(duration_ms) as avg_duration
                FROM method_history
                WHERE url = ? AND hour_of_day = ?
                GROUP BY method
            """,
                (url, hour),
            ).fetchall()

            return self._compute_scores(rows, url)

    def get_best_method(self, url: str, hour: Optional[int] = None) -> Optional[str]:
        """
        Get best method for URL (optionally filtered by hour).

        Args:
            url: Source URL
            hour: Optional hour filter (0-23)

        Returns:
            Best method name or None if no data
        """
        if hour is not None:
            scores = self.get_scores_for_hour(url, hour)
        else:
            scores = self.get_scores_for_url(url)

        return scores[0].method if scores else None

    def get_all_scores(self) -> List[MethodScore]:
        """
        Get scores for all URLs.

        Returns:
            List of MethodScore for all URL/method combinations
        """
        with get_db_connection(self.db_path) as conn:
            rows = conn.execute("""
                SELECT url, method,
                       COUNT(*) as attempts,
                       SUM(success) as successes,
                       AVG(duration_ms) as avg_duration
                FROM method_history
                GROUP BY url, method
            """).fetchall()

            scores = []
            for row in rows:
                success_rate = (
                    row["successes"] / row["attempts"] if row["attempts"] > 0 else 0
                )
                speed_score = max(0, 1 - (row["avg_duration"] / 60000))
                score = (success_rate * 0.6) + (speed_score * 0.4)

                scores.append(
                    MethodScore(
                        url=row["url"],
                        method=row["method"],
                        success_rate=round(success_rate, 3),
                        avg_duration=round(row["avg_duration"], 1),
                        speed_score=round(speed_score, 3),
                        score=round(score, 3),
                        attempts=row["attempts"],
                    )
                )

            return sorted(scores, key=lambda s: s.score, reverse=True)

    def reset_scores(self, url: Optional[str] = None):
        """
        Reset scores for specific URL or all URLs.

        Args:
            url: Optional URL to reset. If None, reset all.
        """
        with get_db_connection(self.db_path) as conn:
            if url:
                conn.execute("DELETE FROM method_history WHERE url = ?", (url,))
                logger.info(f"method_scores_reset url={url}")
            else:
                conn.execute("DELETE FROM method_history")
                logger.info("method_scores_reset all")

            conn.commit()

    def cleanup_old_entries(self, days: int = 30) -> int:
        """
        Remove method_history entries older than N days to prevent unbounded growth.

        Args:
            days: Delete entries older than this many days (default 30)

        Returns:
            Number of entries deleted
        """
        with get_db_connection(self.db_path) as conn:
            cursor = conn.execute(
                "DELETE FROM method_history WHERE timestamp < datetime('now', '-' || ? || ' days')",
                (days,),
            )
            conn.commit()
            deleted = cursor.rowcount
            if deleted:
                logger.info(f"method_history_cleanup deleted={deleted} older_than={days}d")
            return deleted

    def close(self):
        """Close database connection."""
        pass  # Connections are now managed per-operation via context manager
