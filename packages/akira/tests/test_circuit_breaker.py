"""Tests for circuit breaker."""

import pytest
import time
from core.circuit_breaker import CircuitBreaker


def test_circuit_opens_after_threshold():
    cb = CircuitBreaker(threshold=3, timeout=60)
    url = "https://failing.com"

    for _ in range(3):
        cb.record_failure(url, "rss")

    assert cb.is_open(url, "rss") == True


def test_circuit_closes_after_timeout():
    cb = CircuitBreaker(threshold=3, timeout=0.1)
    url = "https://failing.com"

    for _ in range(3):
        cb.record_failure(url, "rss")

    time.sleep(0.15)
    assert cb.is_open(url, "rss") == False


def test_success_resets_circuit():
    cb = CircuitBreaker(threshold=3)
    url = "https://failing.com"

    cb.record_failure(url, "rss")
    cb.record_failure(url, "rss")
    cb.record_success(url, "rss")

    assert cb.failures.get((url, "rss"), -1) == 0


def test_per_extractor_isolation():
    cb = CircuitBreaker(threshold=2, timeout=60)
    url = "https://example.com"

    cb.record_failure(url, "rss")
    cb.record_failure(url, "rss")

    assert cb.is_open(url, "rss") == True
    assert cb.is_open(url, "wordpress") == False

    cb.record_failure(url, "wordpress")
    cb.record_failure(url, "wordpress")

    assert cb.is_open(url, "wordpress") == True
