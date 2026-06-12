"""Health monitoring and auto-recovery for AKIRA."""

import time
import logging
from typing import List, Dict, Optional

from core.engine import ExtractionEngine
from core.cache import CacheManager
from core.circuit_breaker import CircuitBreaker

logger = logging.getLogger("akira")


class HealthMonitor:
    """Health monitoring and auto-recovery system."""

    def __init__(self, cache: CacheManager, circuit_breaker: CircuitBreaker):
        self.cache = cache
        self.circuit_breaker = circuit_breaker

    def check_extractors(self, engine: ExtractionEngine) -> dict:
        """Check each extractor's recent success/failure rate."""
        extractor_health = {}

        for extractor_class in engine.extractors:
            name = extractor_class.NAME
            failures = sum(
                1
                for (url, ext), count in self.circuit_breaker.failures.items()
                if ext == name and count > 0
            )
            open_circuits = sum(
                1
                for (url, ext) in self.circuit_breaker.failures
                if ext == name and self.circuit_breaker.is_open(url, ext)
            )

            status = "healthy"
            if open_circuits > 3:
                status = "degraded"
            if open_circuits > 10:
                status = "unhealthy"

            extractor_health[name] = {
                "status": status,
                "priority": extractor_class.PRIORITY,
                "active_failures": failures,
                "open_circuits": open_circuits,
            }

        return extractor_health

    def check_memory_usage(self, max_mb: int = 500) -> dict:
        """Return memory usage info and whether it exceeds threshold."""
        try:
            import resource

            mem_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
        except Exception:
            mem_mb = 0.0

        return {
            "memory_mb": round(mem_mb, 1),
            "max_mb": max_mb,
            "exceeded": mem_mb > max_mb,
            "usage_percent": round((mem_mb / max_mb) * 100, 1) if max_mb > 0 else 0,
        }

    def check_cache_health(self) -> dict:
        """Check cache hit rate, size, and stale entries."""
        backend = self.cache.backend
        cache_size = len(backend._cache) if hasattr(backend, "_cache") else 0
        max_size = backend.maxsize if hasattr(backend, "maxsize") else 0

        stale_count = 0
        if hasattr(backend, "_expiry"):
            current_time = time.time()
            stale_count = sum(
                1 for expiry in backend._expiry.values() if expiry <= current_time
            )

        hit_rate = self.cache.hit_rate

        health = "healthy"
        if hit_rate < 0.1:
            health = "degraded"
        if stale_count > cache_size * 0.5 and cache_size > 0:
            health = "stale"

        return {
            "status": health,
            "size": cache_size,
            "max_size": max_size,
            "usage_percent": round((cache_size / max_size) * 100, 1)
            if max_size > 0
            else 0,
            "hit_rate": round(hit_rate, 3),
            "stale_entries": stale_count,
            "hits": self.cache._stats.get("hits", 0),
            "misses": self.cache._stats.get("misses", 0),
        }

    def check_circuit_breaker(self) -> dict:
        """Count open circuits and failure distribution."""
        total_entries = len(self.circuit_breaker.failures)
        open_circuits = 0
        half_open = 0
        current_time = time.time()

        for key, failures in self.circuit_breaker.failures.items():
            if failures >= self.circuit_breaker.threshold:
                last_failure = self.circuit_breaker.last_failure.get(key, 0)
                elapsed = current_time - last_failure
                if elapsed >= self.circuit_breaker.timeout:
                    half_open += 1
                else:
                    open_circuits += 1

        return {
            "total_entries": total_entries,
            "open_circuits": open_circuits,
            "half_open": half_open,
            "threshold": self.circuit_breaker.threshold,
            "timeout": self.circuit_breaker.timeout,
        }

    def generate_health_report(self, engine: Optional[ExtractionEngine] = None) -> dict:
        """Full system health report."""
        memory = self.check_memory_usage()
        cache = self.check_cache_health()
        cb = self.check_circuit_breaker()
        extractors = self.check_extractors(engine) if engine else {}

        overall_status = "healthy"
        if memory["exceeded"] or cache["status"] == "stale" or cb["open_circuits"] > 10:
            overall_status = "unhealthy"
        elif cache["status"] == "degraded" or cb["open_circuits"] > 3:
            overall_status = "degraded"

        recommendations = []
        if cache["hit_rate"] < 0.1:
            recommendations.append("Cache hit rate below 10% - consider clearing cache")
        if memory["exceeded"]:
            recommendations.append(
                f"Memory usage {memory['memory_mb']}MB exceeds {memory['max_mb']}MB limit"
            )
        if cb["open_circuits"] > 5:
            recommendations.append(
                f"{cb['open_circuits']} open circuits - consider resetting circuit breaker"
            )
        if cache["stale_entries"] > 0:
            recommendations.append(
                f"{cache['stale_entries']} stale cache entries - run garbage collection"
            )

        return {
            "status": overall_status,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "memory": memory,
            "cache": cache,
            "circuit_breaker": cb,
            "extractors": extractors,
            "recommendations": recommendations,
        }

    def auto_heal(self, engine: Optional[ExtractionEngine] = None) -> dict:
        """Attempt recovery actions based on current health state."""
        actions_taken = []
        success = True

        cache_health = self.check_cache_health()
        cb_health = self.check_circuit_breaker()

        if cache_health["hit_rate"] < 0.1 and cache_health["size"] > 0:
            try:
                backend = self.cache.backend
                if hasattr(backend, "_cache"):
                    backend._cache.clear()
                if hasattr(backend, "_expiry"):
                    backend._expiry.clear()
                self.cache._stats = {"hits": 0, "misses": 0}
                actions_taken.append("Cleared cache (hit rate below 10%)")
                logger.info("auto_heal: cache cleared due to low hit rate")
            except Exception as e:
                actions_taken.append(f"Failed to clear cache: {e}")
                success = False

        if (
            cb_health["open_circuits"] > 0
            and cb_health["total_entries"] == cb_health["open_circuits"]
        ):
            try:
                self.circuit_breaker.failures.clear()
                self.circuit_breaker.last_failure.clear()
                actions_taken.append("Reset all circuit breakers (all circuits open)")
                logger.info("auto_heal: circuit breakers reset")
            except Exception as e:
                actions_taken.append(f"Failed to reset circuit breakers: {e}")
                success = False

        if engine:
            failed_extractors = [
                name
                for name, health in self.check_extractors(engine).items()
                if health["status"] == "unhealthy"
            ]
            if failed_extractors:
                actions_taken.append(
                    f"Unhealthy extractors detected: {', '.join(failed_extractors)}"
                )

        recommendations = []
        if not success:
            recommendations.append(
                "Some auto-heal actions failed - manual intervention may be required"
            )
        if not actions_taken:
            recommendations.append("System appears healthy - no actions needed")

        return {
            "actions_taken": actions_taken,
            "success": success,
            "recommendations": recommendations,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
