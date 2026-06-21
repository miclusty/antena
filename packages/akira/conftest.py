"""Pytest configuration — runs at session start, BEFORE any test file is imported.

Sets AKIRA_DB_PATH at import time so the test DB is used by any test that
imports `main` or `config.settings`. Without this, the singleton
`settings.db_path` would be frozen at the production DB path the first
time any test imports main, and subsequent tests can't override it.

This file must live at the package root (next to pyproject.toml) so
pytest discovers it before collecting test files.
"""
import os
import tempfile
from pathlib import Path

_TEST_DB = Path(tempfile.gettempdir()) / "akira_pytest_default.db"
os.environ.setdefault("AKIRA_DB_PATH", str(_TEST_DB))
