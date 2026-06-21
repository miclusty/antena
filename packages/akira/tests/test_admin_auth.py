"""Tests for admin auth via X-Admin-Key header.

The check_admin() dependency lives in core/app_setup.py and reads
app.state.akira_admin_key (set by main.py from AKIRA_ADMIN_KEY env var).

These tests verify the auth dependency in isolation — we don't need to
run the lifespan or hit real endpoints. We construct a minimal FastAPI
app with one admin-protected route, mount it, and verify the auth
behavior.
"""
import sys

import pytest
from fastapi import APIRouter, Depends, FastAPI
from fastapi.testclient import TestClient


def _fresh_app_with_key(admin_key: str | None) -> FastAPI:
    """Build a tiny app with one /protected route guarded by check_admin."""
    # Force re-import so app.state is fresh.
    if "core.app_setup" in sys.modules:
        del sys.modules["core.app_setup"]

    from core.app_setup import build_app, check_admin

    app = build_app(akira_version="test", akira_admin_key=admin_key)
    router = APIRouter()

    @router.get("/protected")
    async def protected(_auth=Depends(check_admin)):
        return {"ok": True}

    app.include_router(router)
    return app


def test_admin_no_key_configured_returns_401():
    """If AKIRA_ADMIN_KEY is NOT set, return 401 with 'not configured'."""
    app = _fresh_app_with_key(admin_key=None)
    with TestClient(app) as client:
        response = client.get("/protected", headers={"X-Admin-Key": "anything"})
        assert response.status_code == 401
        assert "Admin key not configured" in response.json()["detail"]


def test_admin_no_header_returns_401():
    """Without X-Admin-Key header, return 401."""
    app = _fresh_app_with_key(admin_key="correct-key")
    with TestClient(app) as client:
        response = client.get("/protected")
        assert response.status_code == 401


def test_admin_wrong_key_returns_401():
    """Wrong X-Admin-Key value, return 401."""
    app = _fresh_app_with_key(admin_key="correct-key")
    with TestClient(app) as client:
        response = client.get("/protected", headers={"X-Admin-Key": "wrong"})
        assert response.status_code == 401


def test_admin_correct_key_returns_200():
    """Correct X-Admin-Key passes auth and endpoint returns 200."""
    app = _fresh_app_with_key(admin_key="correct-key")
    with TestClient(app) as client:
        response = client.get("/protected", headers={"X-Admin-Key": "correct-key"})
        assert response.status_code == 200
        assert response.json() == {"ok": True}


def test_admin_empty_string_key_matches_empty_header():
    """Edge case: AKIRA_ADMIN_KEY='' matches X-Admin-Key='' (string equality)."""
    app = _fresh_app_with_key(admin_key="")
    with TestClient(app) as client:
        # Empty env var → key configured as empty string → empty header matches
        response = client.get("/protected", headers={"X-Admin-Key": ""})
        assert response.status_code == 200


def test_admin_auth_dependency_runs_before_endpoint():
    """Auth dependency must fail BEFORE endpoint logic runs.

    We attach an endpoint that would crash if invoked (it tries to
    access a missing state attribute). If auth passes, we should see
    500 (AttributeError). If auth fails, we should see 401.
    """
    if "core.app_setup" in sys.modules:
        del sys.modules["core.app_setup"]
    from core.app_setup import build_app, check_admin

    app = build_app(akira_version="test", akira_admin_key="correct-key")
    router = APIRouter()

    @router.get("/would-crash")
    async def would_crash(_auth=Depends(check_admin)):
        # Force an error if endpoint runs
        raise RuntimeError("endpoint ran — auth did not fire")

    app.include_router(router)

    with TestClient(app) as client:
        # Without auth → 401 (auth dependency catches request first)
        response = client.get("/would-crash")
        assert response.status_code == 401
        assert "Unauthorized" in response.json()["detail"]
