"""Main extraction engine orchestrator with intelligent cascade and delta extraction."""

import time
import asyncio
import logging
from urllib.parse import urlparse
from typing import List, Optional, Type, Tuple
from datetime import datetime

from db.connection import get_db_connection
from db.dedup import filter_new_urls

from extractors.base import BaseExtractor, ExtractedItem
from models.schemas import ExtractResult, MethodName, NewsItem
from core.cache import CacheManager
from core.rate_limiter import RateLimiter
from core.circuit_breaker import CircuitBreaker
from core.method_learner import MethodLearner
from core.method_scorer import MethodScorer

logger = logging.getLogger("akira")


def _update_last_harvest(db_path: Optional[str], source_id: Optional[int]):
    """Update last_harvest_at timestamp after successful extraction."""
    if not db_path or not source_id:
        return
    try:
        with get_db_connection(db_path) as conn:
            conn.execute(
                "UPDATE sources SET last_harvest_at = datetime('now') WHERE id = ?",
                (source_id,),
            )
            conn.commit()
    except Exception as e:
        logger.warning(f"last_harvest_update_failed source_id={source_id}: {e}")


def _method_name_to_enum(name: str) -> MethodName:
    """Convert extractor name to MethodName enum, fallback to JINA for unknown."""
    try:
        return MethodName(name)
    except ValueError:
        return MethodName.JINA


class ExtractionEngine:
    """
    Main extraction orchestrator.
    Manages intelligent cascade through extractors with delta extraction support.
    """

    MAX_RETRIES = 2
    RETRY_BACKOFF_BASE = 1.0

    def __init__(
        self,
        extractors: List[Type[BaseExtractor]],
        cache: CacheManager,
        rate_limiter: RateLimiter,
        circuit_breaker: CircuitBreaker,
        method_learner: Optional[MethodLearner] = None,
        method_scorer: Optional[MethodScorer] = None,
        http_client=None,
        browser_pool=None,
    ):
        self.extractors = sorted(extractors, key=lambda e: e.PRIORITY, reverse=True)
        self.cache = cache
        self.rate_limiter = rate_limiter
        self.circuit_breaker = circuit_breaker
        self.method_learner = method_learner
        self.method_scorer = method_scorer
        self.http_client = http_client
        self.browser_pool = browser_pool
        self._active_extractions = 0
        self._extractions_lock = asyncio.Lock()
        self._in_flight: dict = {}
        self._in_flight_lock = asyncio.Lock()

    def _validate_url(self, url: str) -> bool:
        """Validate URL scheme is http or https."""
        try:
            parsed = urlparse(url)
            return parsed.scheme in ("http", "https")
        except Exception:
            return False

    def _build_optimized_order(self, best_method: str) -> List[Type[BaseExtractor]]:
        """
        Build extractor order optimized by historical success.
        Moves the best method to the front, preserves relative order of others.
        """
        best_extractor = None
        for ext in self.extractors:
            if ext.NAME == best_method:
                best_extractor = ext
                break

        if not best_extractor:
            return list(self.extractors)

        optimized = [best_extractor]
        for ext in self.extractors:
            if ext.NAME != best_method:
                optimized.append(ext)

        return optimized

    async def _retry_with_backoff(
        self, extractor, url: str, timeout: int
    ) -> List[ExtractedItem]:
        """Execute extractor with exponential backoff retry for transient failures."""
        last_error = None
        for attempt in range(self.MAX_RETRIES + 1):
            try:
                return await extractor.extract(url, timeout=timeout)
            except (KeyboardInterrupt, SystemExit, asyncio.CancelledError):
                raise
            except Exception as e:
                last_error = e
                if attempt < self.MAX_RETRIES:
                    backoff = self.RETRY_BACKOFF_BASE * (2**attempt)
                    logger.info(
                        f"retry_attempt url={url} method={extractor.NAME} "
                        f"attempt={attempt + 1} backoff={backoff}s"
                    )
                    await asyncio.sleep(backoff)
                else:
                    raise last_error

    async def extract(
        self,
        url: str,
        source_id: Optional[int] = None,
        prefer_method: Optional[MethodName] = None,
        use_cache: bool = True,
        timeout: int = 60,
        cache_ttl: Optional[int] = None,
        db_path: Optional[str] = None,
    ) -> ExtractResult:
        """
        Extract from URL with intelligent cascade and delta extraction.

        Cascade order (by priority):
        1. Check cache
        2. Check circuit breaker
        3. Try extractors: RSS(100) > WP(90) > Newspaper(70) > Goose(60) >
           Sitemap(50) > Playwright(30) > Jina(10)
        4. Return first success

        Args:
            url: URL to extract from
            source_id: Optional source ID for tracking
            prefer_method: Optional method to try first
            use_cache: Whether to use response cache
            timeout: Max seconds for extraction
            cache_ttl: Cache TTL override (seconds)
            db_path: Path to akira.db for delta extraction (URL dedup)
        """
        if not self._validate_url(url):
            return ExtractResult(
                success=False,
                method=MethodName.JINA,
                type="article",
                duration_ms=0,
                error="Invalid URL scheme - only http/https allowed",
            )

        start_time = time.time()

        # 1. Check cache
        if use_cache:
            cached = await self.cache.get(url)
            if cached:
                logger.info(f"cache_hit url={url}")
                cached["cached"] = True
                return ExtractResult(**cached)

        # 2. Request deduplication — await in-flight request for same URL
        dedup_key = f"{url}:{prefer_method}"
        async with self._in_flight_lock:
            if dedup_key in self._in_flight:
                logger.info(f"awaiting_in_flight url={url}")
                return await self._in_flight[dedup_key]
            future = asyncio.get_running_loop().create_future()
            self._in_flight[dedup_key] = future

        try:
            result = await self._do_extract(
                url,
                source_id,
                prefer_method,
                use_cache,
                timeout,
                cache_ttl,
                start_time,
                db_path,
            )
            async with self._in_flight_lock:
                if not future.done():
                    future.set_result(result)
            return result
        except Exception as e:
            async with self._in_flight_lock:
                if not future.done():
                    future.set_exception(e)
            raise
        finally:
            async with self._in_flight_lock:
                self._in_flight.pop(dedup_key, None)

    async def _do_extract(
        self,
        url: str,
        source_id: Optional[int],
        prefer_method: Optional[MethodName],
        use_cache: bool,
        timeout: int,
        cache_ttl: Optional[int],
        start_time: float,
        db_path: Optional[str] = None,
    ) -> ExtractResult:
        """Internal extraction logic after cache and dedup checks."""
        # Check best historical method
        best_method = None
        if not prefer_method and self.method_learner:
            best_method = self.method_learner.get_best_method(url)
            if best_method:
                logger.info(f"optimized_cascade url={url} best_method={best_method}")

        # Build extractor order
        if best_method:
            order = self._build_optimized_order(best_method)
        elif prefer_method:
            order = self._order_for_method(prefer_method)
        else:
            order = self.extractors

        # Try each extractor
        last_error = None
        for extractor_class in order:
            # Skip if circuit is open for this specific extractor
            if self.circuit_breaker.is_open(url, extractor_class.NAME):
                logger.warning(
                    f"circuit_open url={url} extractor={extractor_class.NAME}"
                )
                continue

            # Check if extractor can handle this URL
            if not extractor_class.can_extract(url):
                continue

            # Rate limit
            await self.rate_limiter.wait(url)

            async with self._extractions_lock:
                self._active_extractions += 1
            try:
                logger.info(f"trying_{extractor_class.NAME} url={url}")

                # Compute remaining time budget for this extractor
                elapsed = time.time() - start_time
                remaining_time = max(timeout - elapsed, 5)
                logger.info(f"timeout_budget url={url} extractor={extractor_class.NAME} remaining={remaining_time:.1f}s")

                extractor = extractor_class(
                    session=self.http_client.session if self.http_client else None,
                    browser_pool=self.browser_pool,
                )
                items = await self._retry_with_backoff(extractor, url, int(remaining_time))

                # Delta extraction: filter out already-seen URLs
                if items and db_path:
                    items = self._filter_seen_items(items, db_path, source_id)

                if items:
                    # Validate content quality
                    items = BaseExtractor.validate_items(items)
                    if not items:
                        logger.warning(
                            f"all_items_invalid url={url} method={extractor_class.NAME}"
                        )
                        last_error = "All extracted items failed validation"
                        self.circuit_breaker.record_failure(url, extractor_class.NAME)
                        continue

                    # Success!
                    self.circuit_breaker.record_success(url, extractor_class.NAME)

                    # Update last_harvest_at for delta extraction
                    _update_last_harvest(db_path, source_id)

                    duration_ms = int((time.time() - start_time) * 1000)

                    # Record success in method learner
                    if self.method_learner:
                        self.method_learner.record_success(
                            url=url,
                            method=extractor_class.NAME,
                            duration_ms=duration_ms,
                            items_count=len(items),
                        )

                    if self.method_scorer:
                        self.method_scorer.record_attempt(
                            url=url,
                            method=extractor_class.NAME,
                            duration_ms=duration_ms,
                            success=True,
                            hour=datetime.now().hour,
                        )

                    result = ExtractResult(
                        success=True,
                        method=_method_name_to_enum(extractor_class.NAME),
                        type="feed" if len(items) > 1 else "article",
                        items=[
                            NewsItem(
                                title=item.title,
                                url=item.url,
                                summary=item.summary,
                                published_at=item.published_at,
                                image_url=item.image_url,
                                source=item.source,
                            )
                            for item in items
                        ],
                        duration_ms=duration_ms,
                        source_id=source_id,
                    )

                    # Cache success
                    if use_cache:
                        ttl = cache_ttl or 600
                        await self.cache.set(url, result.model_dump(), ttl=ttl)

                    logger.info(
                        f"extraction_success url={url} "
                        f"method={extractor_class.NAME} items={len(items)}"
                    )

                    return result

            except (KeyboardInterrupt, SystemExit, asyncio.CancelledError):
                raise
            except Exception as e:
                last_error = str(e)
                self.circuit_breaker.record_failure(url, extractor_class.NAME)

                duration_ms = int((time.time() - start_time) * 1000)

                # Record failure in method learner
                if self.method_learner:
                    self.method_learner.record_failure(
                        url=url,
                        method=extractor_class.NAME,
                        duration_ms=duration_ms,
                        error=str(e),
                    )

                if self.method_scorer:
                    self.method_scorer.record_attempt(
                        url=url,
                        method=extractor_class.NAME,
                        duration_ms=duration_ms,
                        success=False,
                        hour=datetime.now().hour,
                    )

                logger.warning(
                    f"extraction_failed url={url} "
                    f"method={extractor_class.NAME} error={str(e)[:100]}"
                )
                continue
            finally:
                async with self._extractions_lock:
                    self._active_extractions -= 1

        # All extractors failed
        return ExtractResult(
            success=False,
            method=MethodName.JINA,
            type="article",
            duration_ms=int((time.time() - start_time) * 1000),
            source_id=source_id,
            error=last_error or "All extractors failed",
        )

    def _filter_seen_items(
        self, items: List[ExtractedItem], db_path: str, source_id: Optional[int]
    ) -> List[ExtractedItem]:
        """
        Filter out items whose URLs are already in seen_urls table.
        Uses batch queries for performance (single SELECT + batch INSERT).
        """
        if not items:
            return items

        urls = [item.url for item in items if item.url]
        if not urls:
            return []

        # Use shared db_helpers for batch dedup
        new_urls = set(filter_new_urls(db_path, urls, source_id))
        new_items = [
            item for item in items if item.url and item.url in new_urls
        ]

        filtered = len(items) - len(new_items)
        if filtered > 0:
            logger.info(
                f"delta_extraction total={len(items)} "
                f"new={len(new_items)} seen={filtered}"
            )
        return new_items

    @property
    def active_extractions(self) -> int:
        return self._active_extractions

    def _order_for_method(self, method: MethodName) -> List[Type[BaseExtractor]]:
        """Get extractors ordered with preferred method first."""
        return self._build_optimized_order(method.value)
