"""Base extractor class for all extraction methods."""

import asyncio
import logging
import re
from abc import ABC, abstractmethod
from typing import List, Optional
from dataclasses import dataclass

logger = logging.getLogger("akira.extractors")

# Content validation patterns - detect non-news content
ERROR_PATTERNS = [
    re.compile(r"404", re.IGNORECASE),
    re.compile(r"page not found", re.IGNORECASE),
    re.compile(r"access denied", re.IGNORECASE),
    re.compile(r"captcha", re.IGNORECASE),
    re.compile(r"verify you are human", re.IGNORECASE),
    re.compile(r"sign in", re.IGNORECASE),
    re.compile(r"log in", re.IGNORECASE),
    re.compile(r"subscribe to continue", re.IGNORECASE),
    re.compile(r"premium content", re.IGNORECASE),
    re.compile(r"enable javascript", re.IGNORECASE),
    re.compile(r"cloudflare", re.IGNORECASE),
]

# Minimum content thresholds
MIN_TITLE_LENGTH = 5
MIN_SUMMARY_LENGTH = 20
MIN_TEXT_LENGTH = 100


@dataclass
class ExtractedItem:
    """Standard extraction result."""

    title: str = ""
    url: str = ""
    summary: str = ""
    published_at: Optional[str] = None
    image_url: Optional[str] = None
    source: str = ""
    text: Optional[str] = None
    method: str = ""

    def is_valid(self) -> bool:
        """Check if this item has minimum valid content."""
        if not self.title or len(self.title.strip()) < MIN_TITLE_LENGTH:
            return False
        if not self.url or not self.url.startswith("http"):
            return False
        if not self.summary and not self.text:
            return False
        if self.summary and len(self.summary.strip()) < MIN_SUMMARY_LENGTH:
            return False
        if self.text and len(self.text.strip()) < MIN_TEXT_LENGTH:
            return False
        return True

    def is_error_page(self) -> bool:
        """Check if content appears to be an error/login page."""
        content = f"{self.title} {self.summary} {self.text or ''}"
        return any(pattern.search(content) for pattern in ERROR_PATTERNS)


class BaseExtractor(ABC):
    """Base extractor class. Each extractor handles one extraction method."""

    NAME: str = "base"
    PRIORITY: int = 50
    MAX_RETRIES = 2
    RETRY_BACKOFF_BASE = 0.5

    def __init__(
        self,
        session: Optional[object] = None,
        owns_session: bool = False,
        browser_pool=None,
    ):
        self._session = session
        self._owns_session = owns_session
        self._browser_pool = browser_pool

    @abstractmethod
    async def extract(
        self, url: str, timeout: int = 30, **kwargs
    ) -> List[ExtractedItem]:
        pass

    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        return False

    def _default_timeout(self) -> int:
        return 30

    async def extract_with_retry(
        self, url: str, timeout: int = 30
    ) -> List[ExtractedItem]:
        """Extract with automatic retry on transient failures."""
        last_error = None
        for attempt in range(self.MAX_RETRIES + 1):
            try:
                items = await self.extract(url, timeout=timeout)
                return items
            except (ConnectionError, TimeoutError, OSError) as e:
                last_error = e
                if attempt < self.MAX_RETRIES:
                    backoff = self.RETRY_BACKOFF_BASE * (2**attempt)
                    logger.info(
                        f"retry_attempt url={url} method={self.NAME} "
                        f"attempt={attempt + 1} backoff={backoff}s error={type(e).__name__}"
                    )
                    await asyncio.sleep(backoff)
                else:
                    raise last_error

        return []

    @staticmethod
    def validate_items(items: List[ExtractedItem]) -> List[ExtractedItem]:
        """Filter out invalid items and log warnings."""
        valid = []
        for item in items:
            if item.is_error_page():
                logger.warning(f"content_error_page title={item.title[:50]}")
                continue
            if not item.is_valid():
                logger.warning(f"content_invalid title={item.title[:50]}")
                continue
            valid.append(item)
        return valid
