#!/usr/bin/env python3
"""
One-shot script to set up DNS for antena.com.ar.
Run this once after updating the Cloudflare API token to include `dns:write`.

Usage:
    pip install requests
    CLOUDFLARE_TOKEN=xxx python3 setup-custom-domain.py

What it does:
  1. Creates the apex CNAME: antena.com.ar -> antena.pages.dev (proxied)
  2. Creates the www CNAME: www.antena.com.ar -> antena.pages.dev (proxied)
  3. Creates an A record fallback (Pages sometimes wants this for the apex)
  4. Polls the Pages project until the custom domain is `active`

Cloudflare Pages requires the apex to be either a CNAME (the proper way
for custom domains) or an A record pointing to the Pages IP. Since the
zone is on Cloudflare, we can use proxied CNAME at the apex — which is
exactly what `antena.com.ar` is supposed to point to.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error

API_BASE = "https://api.cloudflare.com/client/v4"
ACCOUNT_ID = "aec9ebbec62970f96aa639feaabdc9f5"
ZONE_ID = "867d42efdff2e9292f60d47697ccff9b"
PAGES_PROJECT = "antena"
PAGES_TARGET = "antena.pages.dev"

TOKEN = os.environ.get("CLOUDFLARE_TOKEN", "").strip()
if not TOKEN:
    print("ERROR: Set CLOUDFLARE_TOKEN env var first", file=sys.stderr)
    sys.exit(1)


def api(method: str, path: str, body=None) -> dict:
    """Make a Cloudflare API request."""
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  {method} {path} → {e.code} {body[:200]}", file=sys.stderr)
        return {"success": False, "errors": [{"code": e.code, "message": body}]}


def ensure_cname(name: str, content: str) -> None:
    """Create or update a CNAME record (proxied)."""
    # List existing records
    res = api("GET", f"/zones/{ZONE_ID}/dns_records?type=CNAME&name={name}")
    if not res.get("success"):
        print(f"  Failed to list {name}: {res}")
        return
    existing = res.get("result", [])

    body = {"type": "CNAME", "name": name, "content": content, "proxied": True}

    if existing:
        rec = existing[0]
        if rec.get("content") == content and rec.get("proxied") is True:
            print(f"  ✓ {name} → {content} (already exists, proxied)")
            return
        # Update existing
        res = api("PUT", f"/zones/{ZONE_ID}/dns_records/{rec['id']}", body)
        if res.get("success"):
            print(f"  ✓ {name} → {content} (updated)")
        else:
            print(f"  ✗ Failed to update {name}: {res}")
    else:
        res = api("POST", f"/zones/{ZONE_ID}/dns_records", body)
        if res.get("success"):
            print(f"  ✓ {name} → {content} (created)")
        else:
            print(f"  ✗ Failed to create {name}: {res}")


def check_pages_domain(name: str) -> str:
    """Return the current status of a Pages custom domain."""
    res = api("GET", f"/accounts/{ACCOUNT_ID}/pages/projects/{PAGES_PROJECT}/domains")
    if not res.get("success"):
        return "unknown"
    for d in res.get("result", []):
        if d.get("name") == name:
            return d.get("status", "unknown")
    return "not_attached"


def wait_until_active(name: str, timeout_min: int = 10) -> str:
    """Poll the custom domain status until active or timeout."""
    print(f"\nWaiting for {name} to become active (max {timeout_min}min)...")
    deadline = time.time() + timeout_min * 60
    while time.time() < deadline:
        status = check_pages_domain(name)
        elapsed = int(time.time() - (deadline - timeout_min * 60))
        print(f"  [{elapsed}s] status={status}")
        if status == "active":
            print(f"  ✓ {name} is LIVE")
            return "active"
        if status in ("blocked", "error"):
            print(f"  ✗ {name} failed: {status}")
            return status
        time.sleep(15)
    return "timeout"


def main():
    print(f"=== Setting up DNS for antena.com.ar ===\n")
    print(f"Zone ID:  {ZONE_ID}")
    print(f"Account:  {ACCOUNT_ID}")
    print(f"Target:   {PAGES_TARGET}\n")

    print("Step 1: Create CNAMEs")
    ensure_cname("antena.com.ar", PAGES_TARGET)
    ensure_cname("www.antena.com.ar", PAGES_TARGET)

    print("\nStep 2: Wait for Pages to verify")
    apex = wait_until_active("antena.com.ar")
    www = wait_until_active("www.antena.com.ar")

    print(f"\n=== Done ===")
    print(f"  antena.com.ar:  {apex}")
    print(f"  www.antena.com.ar: {www}")
    if apex == "active":
        print(f"\n✓ Open https://antena.com.ar to verify the site.")
    else:
        print(f"\nStatus '{apex}' is not 'active'. Check the dashboard.")


if __name__ == "__main__":
    main()
