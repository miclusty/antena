"""AKIRA configuration settings."""

import os
from pydantic_settings import BaseSettings
from typing import Optional


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

    # Database path — defaults to relative path from this file
    db_path: str = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "data",
        "akira.db",
    )

    model_config = {"env_prefix": "AKIRA_", "env_file": ".env"}


settings = Settings()
