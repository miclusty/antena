"""Source Recovery Service - Auto-heals failed sources."""

import logging
import asyncio
from dataclasses import dataclass
from enum import Enum
from typing import Optional, List, Dict
from datetime import datetime

from core.db_helpers import get_db_connection

logger = logging.getLogger("akira")


class RecoveryStatus(Enum):
    RECOVERED = "recovered"
    NOT_FOUND = "not_found"
    ALREADY_ACTIVE = "already_active"
    ERROR = "error"


@dataclass
class RecoveryResult:
    url: str
    status: RecoveryStatus
    method_found: Optional[str] = None
    new_url: Optional[str] = None
    error_message: Optional[str] = None


class SourceRecovery:
    """
    Auto-recovers failed sources.

    When a source has 5+ consecutive failures:
    1. Re-scan for RSS/WP API/Sitemap
    2. If found → update source, reset counters
    3. If not found → mark as permanently dead
    """

    RSS_PATHS = ["/feed/", "/rss", "/feed/rss2", "/rss2.xml"]
    WP_API_PATH = "/wp-json/wp/v2/posts?per_page=1"
    SITEMAP_PATHS = ["/sitemap.xml", "/sitemap_index.xml"]
    FAILURE_THRESHOLD = 5

    def __init__(self, db_path: str):
        """
        Initialize with database path.

        Args:
            db_path: Path to D1 or local SQLite database
        """
        self.db_path = db_path
        logger.info(f"source_recovery_initialized db={db_path}")

    def get_failed_sources(self) -> List[Dict]:
        """
        Get all sources with 5+ errors that are still active.

        Returns:
            List of source dicts with url, error_count, last_success, etc.
        """
        with get_db_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT id, name, url, domain, error_count, last_success,
                       rss_url, wp_api_url, sitemap_url
                FROM sources
                WHERE error_count >= ? AND is_active = 1
                ORDER BY error_count DESC
            """,
                (self.FAILURE_THRESHOLD,),
            ).fetchall()

            return [dict(row) for row in rows]

    async def attempt_recovery(self, url: str) -> RecoveryResult:
        """
        Attempt to recover a single failed source.

        Tries in order:
        1. RSS paths
        2. WordPress API
        3. Sitemap

        Args:
            url: Source base URL

        Returns:
            RecoveryResult with status and details
        """
        import aiohttp

        headers = {"User-Agent": "AKIRA/3.2 Source Recovery"}
        timeout = aiohttp.ClientTimeout(total=10)

        # Try RSS paths
        for path in self.RSS_PATHS:
            test_url = f"{url.rstrip('/')}{path}"
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        test_url, headers=headers, timeout=timeout
                    ) as resp:
                        if resp.status == 200:
                            content_type = resp.headers.get("Content-Type", "")
                            if (
                                "xml" in content_type
                                or "rss" in content_type
                                or "atom" in content_type
                            ):
                                self._update_source(url, "rss_url", test_url)
                                logger.info(
                                    f"source_recovered url={url} method=rss path={test_url}"
                                )
                                return RecoveryResult(
                                    url=url,
                                    status=RecoveryStatus.RECOVERED,
                                    method_found="rss",
                                    new_url=test_url,
                                )
            except Exception:
                continue

        # Try WordPress API
        wp_url = f"{url.rstrip('/')}{self.WP_API_PATH}"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    wp_url, headers=headers, timeout=timeout
                ) as resp:
                    if resp.status == 200:
                        self._update_source(url, "wp_api_url", wp_url)
                        logger.info(f"source_recovered url={url} method=wp_api")
                        return RecoveryResult(
                            url=url,
                            status=RecoveryStatus.RECOVERED,
                            method_found="wp_api",
                            new_url=wp_url,
                        )
        except Exception:
            pass

        # Try Sitemap
        for path in self.SITEMAP_PATHS:
            test_url = f"{url.rstrip('/')}{path}"
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        test_url, headers=headers, timeout=timeout
                    ) as resp:
                        if resp.status == 200:
                            content_type = resp.headers.get("Content-Type", "")
                            if "xml" in content_type:
                                self._update_source(url, "sitemap_url", test_url)
                                logger.info(
                                    f"source_recovered url={url} method=sitemap path={test_url}"
                                )
                                return RecoveryResult(
                                    url=url,
                                    status=RecoveryStatus.RECOVERED,
                                    method_found="sitemap",
                                    new_url=test_url,
                                )
            except Exception:
                continue

        # All methods failed - mark as permanently dead
        self._mark_source_dead(url)
        logger.warning(f"source_permanently_dead url={url}")

        return RecoveryResult(
            url=url,
            status=RecoveryStatus.NOT_FOUND,
            error_message="All recovery methods failed",
        )

    async def scan_failed_sources(self) -> List[RecoveryResult]:
        """
        Scan all failed sources and attempt recovery.

        Returns:
            List of RecoveryResult for each source
        """
        failed_sources = self.get_failed_sources()

        if not failed_sources:
            logger.info("no_failed_sources_to_recover")
            return []

        logger.info(f"scanning {len(failed_sources)} failed sources for recovery")

        results = []
        for source in failed_sources:
            result = await self.attempt_recovery(source["url"])
            results.append(result)

        recovered = sum(1 for r in results if r.status == RecoveryStatus.RECOVERED)
        dead = sum(1 for r in results if r.status == RecoveryStatus.NOT_FOUND)

        logger.info(
            f"recovery_scan_complete total={len(results)} "
            f"recovered={recovered} permanently_dead={dead}"
        )

        return results

    def get_recovery_stats(self) -> Dict:
        """
        Get recovery statistics.

        Returns:
            Dict with total_failed, recovered, permanently_dead counts
        """
        with get_db_connection(self.db_path) as conn:
            total_failed = conn.execute(
                "SELECT COUNT(*) FROM sources WHERE error_count >= ?",
                (self.FAILURE_THRESHOLD,),
            ).fetchone()[0]

            permanently_dead = conn.execute(
                "SELECT COUNT(*) FROM sources WHERE deactivation_reason = 'recovery_failed'"
            ).fetchone()[0]

            recovered = conn.execute(
                "SELECT COUNT(*) FROM sources WHERE error_count = 0 AND is_active = 1"
            ).fetchone()[0]

            return {
                "total_failed": total_failed,
                "recovered": recovered,
                "permanently_dead": permanently_dead,
            }

    def _update_source(self, url: str, column: str, value: str):
        """Update source with new endpoint and reset counters."""
        with get_db_connection(self.db_path) as conn:
            conn.execute(
                f"""
                UPDATE sources
                SET {column} = ?,
                    error_count = 0,
                    is_active = 1,
                    deactivation_reason = NULL,
                    last_success = datetime('now')
                WHERE url = ?
            """,
                (value, url),
            )
            conn.commit()

    def _mark_source_dead(self, url: str):
        """Mark source as permanently dead."""
        with get_db_connection(self.db_path) as conn:
            conn.execute(
                """
                UPDATE sources
                SET is_active = 0,
                    deactivation_reason = 'recovery_failed'
                WHERE url = ?
            """,
                (url,),
            )
            conn.commit()

    def close(self):
        """Close database connection (if any cached)."""
        pass  # SQLite connections are opened/closed per operation
