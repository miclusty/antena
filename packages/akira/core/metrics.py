"""Prometheus metrics for AKIRA monitoring."""

import time
from typing import Optional


class MetricsCollector:
    """Collect and expose Prometheus-compatible metrics."""

    def __init__(self):
        self._counters: dict[str, float] = {}
        self._gauges: dict[str, float] = {}
        self._histograms: dict[str, list[float]] = {}
        self._start_time = time.time()

    def increment(self, name: str, value: float = 1.0, labels: Optional[dict] = None):
        """Increment a counter."""
        key = self._key(name, labels)
        self._counters[key] = self._counters.get(key, 0) + value

    def set_gauge(self, name: str, value: float, labels: Optional[dict] = None):
        """Set a gauge value."""
        key = self._key(name, labels)
        self._gauges[key] = value

    def observe(self, name: str, value: float, labels: Optional[dict] = None):
        """Record an observation for a histogram."""
        key = self._key(name, labels)
        if key not in self._histograms:
            self._histograms[key] = []
        self._histograms[key].append(value)

    def _key(self, name: str, labels: Optional[dict]) -> str:
        if not labels:
            return name
        label_str = ",".join(f"{k}={v}" for k, v in sorted(labels.items()))
        return f"{name}{{{label_str}}}"

    def render(self) -> str:
        """Render metrics in Prometheus text format."""
        lines = []

        # Counters
        for key, value in self._counters.items():
            name = key.split("{")[0] if "{" in key else key
            lines.append(f"# TYPE {name} counter")
            lines.append(f"{key} {value:.0f}")

        # Gauges
        for key, value in self._gauges.items():
            name = key.split("{")[0] if "{" in key else key
            lines.append(f"# TYPE {name} gauge")
            lines.append(f"{key} {value:.1f}")

        # Histograms
        for key, values in self._histograms.items():
            name = key.split("{")[0] if "{" in key else key
            count = len(values)
            total = sum(values)
            lines.append(f"# TYPE {name} histogram")
            lines.append(f"{key}_count {count}")
            lines.append(f"{key}_sum {total:.3f}")
            if count > 0:
                lines.append(f"{key}_avg {total / count:.3f}")

        # Uptime
        lines.append("# TYPE akira_uptime_seconds gauge")
        lines.append(f"akira_uptime_seconds {time.time() - self._start_time:.0f}")

        return "\n".join(lines) + "\n"


metrics = MetricsCollector()
