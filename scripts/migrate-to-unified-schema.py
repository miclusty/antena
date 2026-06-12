#!/usr/bin/env python3
"""Migrate existing akira.db to unified schema v2."""

import sqlite3
import sys
import os
import shutil
import time

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "packages", "akira", "data", "akira.db")
MIGRATION_SQL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "migrations", "0002_unified_schema.sql")


def migrate():
    """Apply unified schema migration with backup."""
    if not os.path.exists(DB_PATH):
        print(f"ERROR: Database not found at {DB_PATH}")
        sys.exit(1)

    if not os.path.exists(MIGRATION_SQL):
        print(f"ERROR: Migration SQL not found at {MIGRATION_SQL}")
        sys.exit(1)

    # Backup existing DB
    backup_path = f"{DB_PATH}.backup.{int(time.time())}"
    print(f"Creating backup: {backup_path}")
    shutil.copy2(DB_PATH, backup_path)

    # Read migration SQL
    with open(MIGRATION_SQL) as f:
        migration_sql = f.read()

    # Apply migration (uses IF NOT EXISTS so it's safe to re-run)
    print("Applying migration...")
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.executescript(migration_sql)
        conn.commit()
        print("Migration completed successfully.")
    except Exception as e:
        conn.rollback()
        print(f"Migration FAILED: {e}")
        print(f"Backup available at: {backup_path}")
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
