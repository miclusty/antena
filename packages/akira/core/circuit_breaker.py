"""Circuit breaker pattern for handling failing sources."""

import time
from typing import Dict, Tuple
from collections import OrderedDict


class CircuitBreaker:
    """
    Circuit breaker: pause sources with repeated failures.
    After N consecutive failures, pause for timeout seconds.
    Tracks per (url, extractor) to avoid blocking all extractors for one failure.
    Bounded to prevent unbounded memory growth.
    """

    MAX_ENTRIES = 10000

    def __init__(self, threshold: int = 5, timeout: int = 60):
        self.threshold = threshold
        self.timeout = timeout
        self.failures: Dict[Tuple[str, str], int] = {}
        self.last_failure: OrderedDict[Tuple[str, str], float] = OrderedDict()

    def _key(self, url: str, extractor: str = "") -> Tuple[str, str]:
        return (url, extractor)

    def _evict_oldest(self):
        """Evict oldest entries if we exceed MAX_ENTRIES."""
        while len(self.last_failure) > self.MAX_ENTRIES:
            oldest = next(iter(self.last_failure))
            self.last_failure.pop(oldest)
            self.failures.pop(oldest, None)

    def record_success(self, url: str, extractor: str = "") -> None:
        """Reset failure count on success"""
        key = self._key(url, extractor)
        self.failures[key] = 0
        self.last_failure.pop(key, None)

    def record_failure(self, url: str, extractor: str = "") -> None:
        """Record a failure, may open circuit"""
        key = self._key(url, extractor)
        self.failures[key] = self.failures.get(key, 0) + 1
        self.last_failure[key] = time.time()
        self.last_failure.move_to_end(key)
        self._evict_oldest()

    def is_open(self, url: str, extractor: str = "") -> bool:
        """Check if circuit is open (source should be skipped)"""
        key = self._key(url, extractor)
        if self.failures.get(key, 0) < self.threshold:
            return False

        last = self.last_failure.get(key, 0)
        elapsed = time.time() - last

        if elapsed >= self.timeout:
            # Timeout passed, try again (half-open)
            self.failures[key] = 0
            return False

        return True

    def stats(self) -> dict:
        """Return circuit breaker statistics."""
        total_entries = len(self.failures)
        open_circuits = sum(1 for key in self.failures if self.is_open(key[0], key[1]))
        return {
            "total_entries": total_entries,
            "open_circuits": open_circuits,
            "max_entries": self.MAX_ENTRIES,
            "threshold": self.threshold,
            "timeout": self.timeout,
        }
