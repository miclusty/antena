"""Tests for config.py env var handling.

The pydantic-settings class binds `db_path` to env var AKIRA_DB_PATH
(env_prefix + field upper). For backward compat with deployments that
set AKIRA_DB (the pre-2026-06-20 convention), we accept both via a
model_validator.

These tests verify the priority order:
1. AKIRA_DB (legacy, takes precedence when set)
2. AKIRA_DB_PATH (canonical pydantic-settings var)
3. Relative default (./data/akira.db)
"""
import importlib
import os

import pytest


def test_akira_db_legacy_takes_precedence(monkeypatch):
    """When AKIRA_DB is set, it overrides AKIRA_DB_PATH and the default."""
    monkeypatch.setenv("AKIRA_DB", "/tmp/legacy.db")
    monkeypatch.setenv("AKIRA_DB_PATH", "/tmp/canonical.db")
    monkeypatch.delenv("AKIRA_CACHE_BACKEND", raising=False)

    import config as cfg
    importlib.reload(cfg)
    assert cfg.settings.db_path == "/tmp/legacy.db"


def test_akira_db_path_canonical(monkeypatch):
    """When only AKIRA_DB_PATH is set, it's used (canonical behavior)."""
    monkeypatch.delenv("AKIRA_DB", raising=False)
    monkeypatch.setenv("AKIRA_DB_PATH", "/tmp/canonical.db")
    monkeypatch.delenv("AKIRA_CACHE_BACKEND", raising=False)

    import config as cfg
    importlib.reload(cfg)
    assert cfg.settings.db_path == "/tmp/canonical.db"


def test_default_path_when_nothing_set(monkeypatch):
    """When neither env var is set, the relative default is used."""
    monkeypatch.delenv("AKIRA_DB", raising=False)
    monkeypatch.delenv("AKIRA_DB_PATH", raising=False)
    monkeypatch.delenv("AKIRA_CACHE_BACKEND", raising=False)

    import config as cfg
    importlib.reload(cfg)
    # Default points at <package>/data/akira.db
    assert cfg.settings.db_path.endswith("data/akira.db")
    assert "akira" in cfg.settings.db_path


def test_akira_db_overrides_dotenv(monkeypatch):
    """AKIRA_DB in os.environ should win over AKIRA_DB_PATH in .env file.

    The .env file in the package contains AKIRA_DB_PATH. The model_validator
    ensures runtime env vars override file-based config.
    """
    monkeypatch.setenv("AKIRA_DB", "/tmp/runtime-override.db")
    # .env file has AKIRA_DB_PATH=/Users/omatic/.../data/akira.db
    # — model_validator should let AKIRA_DB win.

    import config as cfg
    importlib.reload(cfg)
    assert cfg.settings.db_path == "/tmp/runtime-override.db"


def test_cache_backend_default(monkeypatch):
    """cache_backend defaults to 'memory'."""
    monkeypatch.delenv("AKIRA_CACHE_BACKEND", raising=False)

    import config as cfg
    importlib.reload(cfg)
    assert cfg.settings.cache_backend == "memory"


def test_cache_backend_from_env(monkeypatch):
    """AKIRA_CACHE_BACKEND env var is picked up."""
    monkeypatch.setenv("AKIRA_CACHE_BACKEND", "redis")

    import config as cfg
    importlib.reload(cfg)
    assert cfg.settings.cache_backend == "redis"