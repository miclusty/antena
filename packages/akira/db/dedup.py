"""URL deduplication for incremental extraction.

Provides `filter_new_urls`, which checks each URL in a batch against the
`seen_urls` table and returns only those that have not been seen before.
New URLs are inserted (or bumped in `view_count`) so subsequent extractor
runs skip them — this is how RSS/WordPress delta extraction avoids
re-processing the same articles on every cycle.

Originally lived in `core/db_helpers.py`, moved here as part of the
canonical DB connection migration (PR 2 of AKIRA Iter 4) so that dedup
uses the same WAL + mmap + cache connection as the rest of the system
instead of the legacy 2-PRAGMA connection.
"""

import logging
from typing import List, Optional

from db.connection import get_db_connection

logger = logging.getLogger(__name__)


def filter_new_urls(db_path: str, urls: List[str], source_id: Optional[int] = None) -> List[str]:
    """Filter out URLs already in seen_urls table. Batch-checks + batch-inserts new ones.

    Returns list of new URLs (not previously seen). Inserts new URLs into seen_urls.
    Used by extractors (RSS, WordPress) and engine for delta extraction dedup.
    """
    if not urls:
        return []
    try:
        with get_db_connection(db_path) as conn:
            placeholders = ",".join("?" for _ in urls)
            seen = {
                row[0]
                for row in conn.execute(
                    f"SELECT url FROM seen_urls WHERE url IN ({placeholders})", urls
                )
            }
            new_urls = [u for u in urls if u not in seen]
            if new_urls:
                conn.executemany(
                    """INSERT INTO seen_urls (url, source_id, first_seen, last_seen, view_count)
                       VALUES (?, ?, datetime('now'), datetime('now'), 1)
                       ON CONFLICT(url) DO UPDATE SET
                         last_seen = datetime('now'),
                         view_count = view_count + 1""",
                    [(url, source_id) for url in new_urls],
                )
                conn.commit()
            return new_urls
    except Exception as e:
        logger.error(f"Error filtering URLs: {e}")
        return urls
