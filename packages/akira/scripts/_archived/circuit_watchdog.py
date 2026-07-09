#!/usr/bin/env python3
# DEPRECATED 2026-06-20: Manual circuit-breaker monitor for AKIRA sources.
# Replaced by auto-heal in the GC loop + HealthMonitor in main.py.
# Do NOT run this script unless you know what you're doing. See git history
# for the implementation if you need to revive it.
#
# Original docstring preserved below for reference.
#
"""AKIRA circuit-breaker watchdog.

Background task: every WATCHDOG_INTERVAL_MIN minutes, scan
source_health for sources with is_circuit_open=1 and try a tiny
GET against each one. If the source responds, close the circuit
(failures=0, is_circuit_open=0) so the next harvest picks it up.

Without this, sources that hit 5+ consecutive failures get their
circuit opened, and nothing closes it until a future harvest
happenstances to re-pick that source — which can be hours or days
in a long-tail distribution. The watchdog turns that into a fixed
N-minute SLA.

Usage:
    cd packages/akira
    source .venv/bin/activate
    python scripts/circuit_watchdog.py
    # or with custom interval:
    python scripts/circuit_watchdog.py --interval 10

Loops forever. Logs to stdout. Intended to be launched as a PM2
process or alongside the main pipeline.
"""
import argparse
import os
import sys
import time
import urllib.error
import urllib.request

AKIRA_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "akira.db")
WATCHDOG_INTERVAL_MIN = 15
PROBE_TIMEOUT = 10


def probe(url: str) -> bool:
    """Return True if the URL responds with any HTTP 2xx/3xx/4xx
    (i.e. the host is reachable, regardless of whether the RSS is
    valid). 5xx and network errors are False."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "akira-watchdog/1.0"})
        with urllib.request.urlopen(req, timeout=PROBE_TIMEOUT) as r:
            return r.status < 500
    except urllib.error.HTTPError as e:
        # 4xx means the host is up, the path is wrong. That's
        # still "alive" — the harvest will retry with the right path.
        return e.code < 500
    except Exception:
        return False


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--interval", type=int, default=WATCHDOG_INTERVAL_MIN,
                   help="Minutes between circuit-breaker probes (default: 15)")
    p.add_argument("--once", action="store_true",
                   help="Run once and exit (for testing)")
    args = p.parse_args()

    interval_s = args.interval * 60
    print(f"circuit_watchdog started: interval={args.interval}m db={AKIRA_DB}", flush=True)

    while True:
        try:
            with get_db_connection(AKIRA_DB, timeout=10) as conn:
                conn.execute("PRAGMA busy_timeout=30000")
                rows = conn.execute("""
                SELECT sh.source_id, sh.url, s.name
                FROM source_health sh
                LEFT JOIN sources s ON s.id = sh.source_id
                WHERE sh.is_circuit_open = 1 AND sh.consecutive_failures >= 5
                """).fetchall()
                if rows:
                    print(f"[watchdog] probing {len(rows)} sources with open circuit...", flush=True)
                    recovered = 0
                    still_down = 0
                    for source_id, url, name in rows:
                        if probe(url):
                            conn.execute("""
                                UPDATE source_health
                                SET consecutive_failures = 0,
                            is_circuit_open = 0,
                            last_failure_at = 0
                        WHERE source_id = ? AND is_circuit_open = 1
                    """, (source_id,))
                    recovered += 1
                    print(f"  RECOVERED: {name} ({url})", flush=True)
                else:
                    still_down += 1
                if recovered or still_down:
                    conn.commit()
                    print(
                        f"[watchdog] recovered={recovered} still_down={still_down} "
                        f"of {len(rows)} probed",
                        flush=True,
                    )
        except Exception as e:
            print(f"[watchdog] error: {type(e).__name__}: {e}", flush=True)

        if args.once:
            break
        time.sleep(interval_s)


if __name__ == "__main__":
    main()
