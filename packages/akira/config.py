"""AKIRA configuration settings."""

import os
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional, Self


_DEFAULT_DB_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "data",
    "akira.db",
)


class Settings(BaseSettings):
    """AKIRA engine configuration."""

    # Server settings
    host: str = "0.0.0.0"
    port: int = 5000
    workers: int = 4
    debug: bool = False

    # Cache settings
    cache_backend: str = "memory"
    cache_ttl: int = 600
    cache_max_size: int = 1000
    redis_url: Optional[str] = None

    # Extraction settings
    request_delay: float = 1.5
    max_concurrent: int = 20
    default_timeout: int = 60

    # Circuit breaker settings
    circuit_breaker_threshold: int = 5
    circuit_breaker_timeout: int = 60

    # D1 sync settings
    node_api_url: str = "http://localhost:8787"
    node_api_key: Optional[str] = None

    # Database path. pydantic-settings binds this to AKIRA_DB_PATH (prefix +
    # field name uppercased). The legacy env var AKIRA_DB was used in earlier
    # deployments and the .env.example file before 2026-06-20 — see
    # _resolve_db_path_compat() below.
    db_path: str = _DEFAULT_DB_PATH

    model_config = SettingsConfigDict(
        env_prefix="AKIRA_",
        env_file=".env",
        env_ignore_empty=True,
        extra="ignore",
    )

    @model_validator(mode="after")
    def _resolve_db_path_compat(self) -> Self:
        """Accept the legacy AKIRA_DB env var as a backward-compat alias for
        AKIRA_DB_PATH. AKIRA_DB wins when both are set (matches the principle
        of least surprise: the variable the user explicitly set is honored).

        This runs AFTER pydantic-settings has applied env_file + os.environ,
        so we override only if AKIRA_DB is set and it differs from what
        pydantic-settings resolved.
        """
        legacy = os.getenv("AKIRA_DB")
        if legacy and legacy != self.db_path:
            self.db_path = legacy
        return self


settings = Settings()