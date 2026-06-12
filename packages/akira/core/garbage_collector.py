"""Smart garbage collector for AKIRA cache cleanup."""

import time
from typing import Optional

from core.cache import CacheManager
from core.circuit_breaker import CircuitBreaker


class GarbageCollector:
    """Smart garbage collector for cache and system cleanup."""

    def __init__(self, cache: CacheManager, circuit_breaker: CircuitBreaker):
        self.cache = cache
        self.circuit_breaker = circuit_breaker
        self.stats = {
            "items_collected": 0,
            "memory_freed_mb": 0.0,
            "last_run": None,
        }

    def _get_memory_usage_mb(self) -> float:
        """Get current process memory usage in MB."""
        try:
            import resource

            return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
        except Exception:
            return 0.0

    def collect_expired(self) -> dict:
        """Remove all expired entries from cache."""
        collected = 0
        backend = self.cache.backend

        if hasattr(backend, "_cache") and hasattr(backend, "_expiry"):
            expired_keys = [
                key for key, expiry in backend._expiry.items() if expiry <= time.time()
            ]
            for key in expired_keys:
                backend._cache.pop(key, None)
                backend._expiry.pop(key, None)
                collected += 1

        self.stats["items_collected"] += collected
        return {
            "method": "collect_expired",
            "items_collected": collected,
        }

    def collect_stale(self, threshold_hours: int = 24) -> dict:
        """Remove entries older than threshold."""
        collected = 0
        backend = self.cache.backend

        if hasattr(backend, "_cache") and hasattr(backend, "_expiry"):
            threshold = time.time() - (threshold_hours * 3600)
            stale_keys = [
                key for key, expiry in backend._expiry.items() if expiry < threshold
            ]
            for key in stale_keys:
                backend._cache.pop(key, None)
                backend._expiry.pop(key, None)
                collected += 1

        self.stats["items_collected"] += collected
        return {
            "method": "collect_stale",
            "threshold_hours": threshold_hours,
            "items_collected": collected,
        }

    def collect_by_size(self, max_entries: int = 500) -> dict:
        """Keep only most recent entries, remove oldest beyond max_entries."""
        collected = 0
        backend = self.cache.backend

        if hasattr(backend, "_cache"):
            current_size = len(backend._cache)
            if current_size > max_entries:
                excess = current_size - max_entries
                for _ in range(excess):
                    oldest = next(iter(backend._cache), None)
                    if oldest:
                        backend._cache.pop(oldest, None)
                        if hasattr(backend, "_expiry"):
                            backend._expiry.pop(oldest, None)
                        collected += 1

        self.stats["items_collected"] += collected
        return {
            "method": "collect_by_size",
            "max_entries": max_entries,
            "items_collected": collected,
        }

    def collect_circuit_breaker(self) -> dict:
        """Reset circuit breaker entries older than timeout."""
        reset_count = 0
        current_time = time.time()

        stale_keys = [
            key
            for key, last_failure in self.circuit_breaker.last_failure.items()
            if current_time - last_failure >= self.circuit_breaker.timeout
        ]
        for key in stale_keys:
            self.circuit_breaker.failures.pop(key, None)
            self.circuit_breaker.last_failure.pop(key, None)
            reset_count += 1

        return {
            "method": "collect_circuit_breaker",
            "entries_reset": reset_count,
        }

    def collect_logs(self, max_age_hours: int = 6) -> dict:
        """Clean old log entries if any."""
        return {
            "method": "collect_logs",
            "max_age_hours": max_age_hours,
            "items_collected": 0,
            "note": "No persistent log storage configured",
        }

    def collect_all(self) -> dict:
        """Run all collection methods and return combined stats."""
        mem_before = self._get_memory_usage_mb()
        start_time = time.time()

        results = {
            "expired": self.collect_expired(),
            "stale": self.collect_stale(),
            "by_size": self.collect_by_size(),
            "circuit_breaker": self.collect_circuit_breaker(),
            "logs": self.collect_logs(),
        }

        total_collected = sum(r.get("items_collected", 0) for r in results.values())
        total_collected += sum(r.get("entries_reset", 0) for r in results.values())

        mem_after = self._get_memory_usage_mb()
        duration_ms = int((time.time() - start_time) * 1000)

        self.stats["items_collected"] = total_collected
        self.stats["memory_freed_mb"] = round(max(0, mem_before - mem_after), 2)
        self.stats["last_run"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        return {
            "total_items_collected": total_collected,
            "memory_freed_mb": self.stats["memory_freed_mb"],
            "duration_ms": duration_ms,
            "details": results,
            "last_run": self.stats["last_run"],
        }
