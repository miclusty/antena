"""AKIRA - PULSO Extraction Engine. FastAPI application.

This module is a thin shim. It composes:

  - the FastAPI app (built by `core.app_setup.build_app`)
  - CORS middleware
  - all route modules under `routes/`

Everything that requires deep app state (lifespan, GC loop, structured
logging, request-id middleware, exception handler, admin-key check)
lives in `core.app_setup`.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.middleware.cors import CORSMiddleware

from core.app_setup import AKIRA_VERSION, build_app
from routes import (
    admin as admin_routes,
    categories as categories_routes,
    extraction as extraction_routes,
    feed as feed_routes,
    locations as locations_routes,
    radios as radios_routes,
    sources as sources_routes,
    stats as stats_routes,
    synthesis as synthesis_routes,
)

ALLOWED_ORIGINS = [
    "http://localhost:4321",
    "http://localhost:4322",
    "http://localhost:4324",
    "http://localhost:8787",
    "http://localhost:5000",
    "https://api.akira.ar",
]

app = build_app(
    akira_version=AKIRA_VERSION,
    akira_admin_key=os.getenv("AKIRA_ADMIN_KEY"),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(feed_routes.router)
app.include_router(categories_routes.router)
app.include_router(locations_routes.router)
app.include_router(sources_routes.router)
app.include_router(radios_routes.router)
app.include_router(extraction_routes.router)
app.include_router(synthesis_routes.router)
app.include_router(admin_routes.router)
app.include_router(stats_routes.router)
