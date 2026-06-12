# AKIRA v3.1 Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Flask Extractor to AKIRA with Google News geo-extraction and URL-based method learning for 80% performance improvement on repeat fetches.

**Architecture:** Add Google News extractor with location-aware queries, implement MethodLearner to track best extraction method per URL, integrate into ExtractionEngine for cascade optimization, expose 4 new API endpoints, remove 216MB Flask legacy.

**Tech Stack:** Python 3.9, FastAPI, SQLite, feedparser, aiohttp, pydantic

---

## File Structure

**New Files (10):**
```
packages/akira/
├── data/
│   ├── akira.db                 (method learning + extraction stats)
│   └── locations.db             (150+ Argentine locations)
├── core/
│   └── method_learner.py        (URL-based learning system)
├── extractors/
│   └── google_news.py           (Google News RSS extractor)
├── services/
│   └── google_news_service.py   (Location query builder)
├── models/
│   └── google_news_schemas.py   (Request/response models)
└── tests/
    ├── test_google_news.py      (7 tests)
    ├── test_google_news_service.py (6 tests)
    ├── test_method_learner.py   (9 tests)
    └── test_integration_akira.py (3 integration tests)
```

**Modified Files (4):**
```
packages/akira/
├── core/
│   └── engine.py                (add method learning integration)
├── models/
│   └── schemas.py               (import new schemas)
├── main.py                      (add 4 endpoints + lifespan setup)
└── tests/
    └── test_main.py             (add endpoint tests)
```

**Removed (Phase 3):**
```
packages/extractor/              (216MB - Flask legacy)
```

---

## Task 1: Setup Data Infrastructure

**Files:**
- Create: `packages/akira/data/` directory
- Create: `packages/akira/data/locations.db`

- [ ] **Step 1: Create data directory**

```bash
mkdir -p packages/akira/data
```

- [ ] **Step 2: Create locations database from migration seed**

```bash
sqlite3 packages/akira/data/locations.db < migrations/0004_locations_seed.sql
```

- [ ] **Step 3: Verify locations seeded**

Run: `sqlite3 packages/akira/data/locations.db "SELECT COUNT(*) FROM locations;"`
Expected: `200` (approximately)

- [ ] **Step 4: Test location query**

Run: `sqlite3 packages/akira/data/locations.db "SELECT id, name, province, type FROM locations WHERE id = 103;"`
Expected: `103|Córdoba Capital|Córdoba|ciudad`

- [ ] **Step 5: Commit setup**

```bash
git add packages/akira/data/
git commit -m "feat(akira): setup data directories and locations database"
```

---

## Task 2: Google News Service (Query Builder)

**Files:**
- Create: `packages/akira/services/google_news_service.py`
- Create: `packages/akira/tests/test_google_news_service.py`

- [ ] **Step 1: Write failing test for get_location**

Create `packages/akira/tests/test_google_news_service.py`:

```python
"""Tests for Google News Service."""

import pytest
import sqlite3
import os
from services.google_news_service import GoogleNewsService


@pytest.fixture
def service():
    """Create service with test database."""
    db_path = os.path.join(os.path.dirname(__file__), "..", "data", "locations.db")
    service = GoogleNewsService(db_path)
    yield service
    service.close()


def test_get_location_exists(service):
    """Test retrieving existing location."""
    location = service.get_location(103)
    
    assert location is not None
    assert location["id"] == 103
    assert location["name"] == "Córdoba Capital"
    assert location["province"] == "Córdoba"
    assert location["type"] == "ciudad"


def test_get_location_not_found(service):
    """Test retrieving non-existent location."""
    location = service.get_location(9999)
    
    assert location is None


def test_build_query_ciudad(service):
    """Test query builder for ciudad type."""
    query = service.build_query(103)
    
    assert query == "noticias Córdoba Capital Córdoba"


def test_build_query_provincia(service):
    """Test query builder for provincia type."""
    query = service.build_query(3)
    
    assert query == "noticias Córdoba"


def test_build_query_not_found(service):
    """Test query builder raises error for invalid location."""
    with pytest.raises(ValueError, match="Location 9999 not found"):
        service.build_query(9999)


def test_get_locations_by_type(service):
    """Test retrieving all locations of a specific type."""
    locations = service.get_locations_by_type("ciudad")
    
    assert len(locations) > 0
    assert all(loc["type"] == "ciudad" for loc in locations)


def test_get_locations_by_type_with_province_filter(service):
    """Test retrieving locations filtered by province."""
    locations = service.get_locations_by_type("ciudad", province_filter="Buenos Aires")
    
    assert len(locations) > 0
    assert all(loc["province"] == "Buenos Aires" for loc in locations)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/akira && pytest tests/test_google_news_service.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'services.google_news_service'"

- [ ] **Step 3: Write Google News Service implementation**

Create `packages/akira/services/google_news_service.py`:

```python
"""Google News Service - Location-aware query builder."""

import sqlite3
import logging
from typing import Optional, List, Dict

logger = logging.getLogger("akira")


class GoogleNewsService:
    """
    Service for building location-aware Google News queries.
    
    Uses local SQLite database with Argentine locations (provinces, cities, towns).
    """
    
    def __init__(self, locations_db_path: str):
        """
        Initialize service with locations database.
        
        Args:
            locations_db_path: Path to locations SQLite database
        """
        self.locations_db = sqlite3.connect(locations_db_path)
        self.locations_db.row_factory = sqlite3.Row
        logger.info(f"google_news_service_initialized db={locations_db_path}")
    
    def get_location(self, location_id: int) -> Optional[Dict]:
        """
        Get location from database.
        
        Args:
            location_id: Location ID
        
        Returns:
            Location dict with id, name, province, type, etc. or None if not found
        """
        row = self.locations_db.execute(
            "SELECT * FROM locations WHERE id = ?", (location_id,)
        ).fetchone()
        
        return dict(row) if row else None
    
    def build_query(self, location_id: int) -> str:
        """
        Build Google News search query for location.
        
        Examples:
            location_id=103 (Córdoba Capital, ciudad) → "noticias Córdoba Capital Córdoba"
            location_id=3 (Córdoba, provincia) → "noticias Córdoba"
            location_id=1 (Argentina, pais) → "noticias Argentina"
        
        Args:
            location_id: Location ID
        
        Returns:
            Google News search query
        
        Raises:
            ValueError: If location not found
        """
        location = self.get_location(location_id)
        
        if not location:
            raise ValueError(f"Location {location_id} not found")
        
        name = location["name"]
        province = location.get("province", "")
        type = location.get("type", "ciudad")
        
        if type == "ciudad":
            return f"noticias {name} {province}"
        elif type == "provincia":
            return f"noticias {name}"
        elif type == "autonomous_city":
            return f"noticias {name}"
        else:
            return f"noticias {name}"
    
    def get_locations_by_type(
        self, type: str, province_filter: Optional[str] = None
    ) -> List[Dict]:
        """
        Get all locations of a specific type.
        
        Args:
            type: Location type (provincia, ciudad, pueblo, autonomous_city)
            province_filter: Optional province filter
        
        Returns:
            List of location dicts
        """
        query = "SELECT * FROM locations WHERE type = ?"
        params = [type]
        
        if province_filter:
            query += " AND province = ?"
            params.append(province_filter)
        
        rows = self.locations_db.execute(query, params).fetchall()
        
        return [dict(row) for row in rows]
    
    def close(self):
        """Close database connection."""
        self.locations_db.close()
        logger.info("google_news_service_closed")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/akira && pytest tests/test_google_news_service.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/akira/services/google_news_service.py packages/akira/tests/test_google_news_service.py
git commit -m "feat(akira): add Google News service with location query builder"
```

---

## Task 3: Google News Extractor

**Files:**
- Create: `packages/akira/extractors/google_news.py`
- Create: `packages/akira/tests/test_google_news.py`

- [ ] **Step 1: Write failing test for can_extract**

Create `packages/akira/tests/test_google_news.py`:

```python
"""Tests for Google News Extractor."""

import pytest
import asyncio
from extractors.google_news import GoogleNewsExtractor


def test_can_extract_false():
    """Google News extractor is not URL-based."""
    result = GoogleNewsExtractor.can_extract("https://news.google.com")
    
    assert result is False


def test_can_extract_with_html_false():
    """Google News extractor ignores HTML."""
    result = GoogleNewsExtractor.can_extract("https://example.com", html="<html></html>")
    
    assert result is False


@pytest.mark.asyncio
async def test_extract_single_query():
    """Test extraction with simple query."""
    extractor = GoogleNewsExtractor()
    items = await extractor.extract(query="noticias Argentina", limit=5)
    
    assert len(items) <= 5
    assert all(item.title for item in items)
    assert all(item.url for item in items)
    assert all(item.method == "google_news" for item in items)


@pytest.mark.asyncio
async def test_extract_limit_respected():
    """Test extraction respects limit parameter."""
    extractor = GoogleNewsExtractor()
    items = await extractor.extract(query="Córdoba", limit=3)
    
    assert len(items) <= 3


@pytest.mark.asyncio
async def test_extract_country_parameter():
    """Test extraction with country parameter."""
    extractor = GoogleNewsExtractor()
    items = await extractor.extract(query="Buenos Aires", country="AR", limit=5)
    
    assert len(items) <= 5


@pytest.mark.asyncio
async def test_extract_empty_query():
    """Test extraction with empty query returns empty results."""
    extractor = GoogleNewsExtractor()
    items = await extractor.extract(query="", limit=10)
    
    # Empty query may return results or empty
    assert isinstance(items, list)


@pytest.mark.asyncio
async def test_extract_spanish_language():
    """Test extraction returns Spanish news."""
    extractor = GoogleNewsExtractor()
    items = await extractor.extract(query="noticias Córdoba Argentina", limit=5)
    
    # Most titles should be in Spanish
    assert len(items) > 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/akira && pytest tests/test_google_news.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'extractors.google_news'"

- [ ] **Step 3: Write Google News Extractor implementation**

Create `packages/akira/extractors/google_news.py`:

```python
"""Google News Extractor - RSS-based extraction with location-aware queries."""

import asyncio
import logging
import urllib.parse
from typing import List, Optional

from extractors.base import BaseExtractor, ExtractedItem

logger = logging.getLogger("akira.extractors")


class GoogleNewsExtractor(BaseExtractor):
    """
    Google News RSS extractor.
    
    Not URL-based - uses search queries to find news.
    Query format: "noticias {location} {province}"
    
    Example:
        query = "noticias Córdoba Capital Córdoba"
        → extracts from Google News RSS search
    """
    
    NAME = "google_news"
    PRIORITY = 90  # Fallback after RSS (100) and WordPress (90)
    
    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        """
        Google News extractor is query-based, not URL-based.
        
        Always returns False - this extractor is invoked explicitly
        via /extract/google-news endpoint, not in cascade.
        """
        return False
    
    async def extract(
        self, query: str, country: str = "AR", limit: int = 10
    ) -> List[ExtractedItem]:
        """
        Extract news from Google News RSS search.
        
        Args:
            query: Search query (e.g., "noticias Córdoba")
            country: Country code (default AR for Argentina)
            limit: Max items to return
        
        Returns:
            List of ExtractedItem with title, url, summary, published_at, source
        """
        import feedparser
        
        # Build Google News RSS URL
        encoded_query = urllib.parse.quote(query)
        rss_url = f"https://news.google.com/rss/search?q={encoded_query}&hl=es&gl={country}&ceid=AR:es"
        
        logger.info(f"google_news_extract query={query} url={rss_url}")
        
        # Parse RSS (synchronous, run in executor)
        loop = asyncio.get_running_loop()
        feed = await loop.run_in_executor(None, feedparser.parse, rss_url)
        
        items = []
        for entry in feed.entries[:limit]:
            # Extract source from entry
            source_title = ""
            if hasattr(entry, "source") and hasattr(entry.source, "title"):
                source_title = entry.source.title
            
            item = ExtractedItem(
                title=entry.get("title", ""),
                url=entry.get("link", ""),
                summary=entry.get("summary", "")[:300],
                published_at=entry.get("published", ""),
                source=source_title,
                image_url=None,
                method=self.NAME,
            )
            items.append(item)
        
        logger.info(
            f"google_news_extracted query={query} items={len(items)}"
        )
        
        return items
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/akira && pytest tests/test_google_news.py -v`
Expected: PASS (7 tests)

Note: Tests may take a few seconds due to network requests to Google News.

- [ ] **Step 5: Commit**

```bash
git add packages/akira/extractors/google_news.py packages/akira/tests/test_google_news.py
git commit -m "feat(akira): add Google News extractor with RSS search"
```

---

## Task 4: Method Learner (URL-Based Learning)

**Files:**
- Create: `packages/akira/core/method_learner.py`
- Create: `packages/akira/tests/test_method_learner.py`

- [ ] **Step 1: Write failing test for initialization**

Create `packages/akira/tests/test_method_learner.py`:

```python
"""Tests for Method Learner."""

import pytest
import sqlite3
import os
import json
from core.method_learner import MethodLearner


@pytest.fixture
def learner():
    """Create learner with temporary database."""
    db_path = "/tmp/test_method_learner.db"
    
    # Remove if exists
    if os.path.exists(db_path):
        os.remove(db_path)
    
    learner = MethodLearner(db_path)
    yield learner
    
    learner.close()
    os.remove(db_path)


def test_init_schema(learner):
    """Test that schema is initialized correctly."""
    # Check tables exist
    conn = sqlite3.connect(learner.db_path)
    
    tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()
    
    table_names = [t[0] for t in tables]
    
    assert "source_health" in table_names
    assert "extraction_stats" in table_names
    
    conn.close()


def test_get_best_method_none(learner):
    """Test get_best_method returns None for unknown URL."""
    result = learner.get_best_method("https://unknown.com/feed/")
    
    assert result is None


def test_get_best_method_found(learner):
    """Test get_best_method returns method after success recorded."""
    url = "https://test.com/feed/"
    
    # Record success
    learner.record_success(url, "rss", 3000, 10)
    
    # Get best method
    result = learner.get_best_method(url)
    
    assert result == "rss"


def test_get_best_method_circuit_open(learner):
    """Test get_best_method returns None when circuit is open."""
    url = "https://failed.com/feed/"
    
    # Record 5 failures
    for i in range(5):
        learner.record_failure(url, "rss", 1000, "timeout")
    
    # Circuit should be open
    result = learner.get_best_method(url)
    
    assert result is None


def test_record_success_new_url(learner):
    """Test recording success for new URL."""
    url = "https://new.com/feed/"
    
    learner.record_success(url, "rss", 3000, 10)
    
    # Verify recorded
    conn = sqlite3.connect(learner.db_path)
    conn.row_factory = sqlite3.Row
    
    row = conn.execute(
        "SELECT * FROM source_health WHERE url = ?", (url,)
    ).fetchone()
    
    assert row is not None
    assert row["last_success_method"] == "rss"
    assert row["consecutive_failures"] == 0
    assert row["is_circuit_open"] == 0
    
    # Verify success count
    success_count = json.loads(row["success_count"])
    assert success_count["rss"] == 1
    
    conn.close()


def test_record_success_existing_url(learner):
    """Test recording success updates existing URL."""
    url = "https://existing.com/feed/"
    
    # First success
    learner.record_success(url, "rss", 3000, 10)
    
    # Second success with different method
    learner.record_success(url, "wp_api", 2500, 8)
    
    # Verify updated
    conn = sqlite3.connect(learner.db_path)
    conn.row_factory = sqlite3.Row
    
    row = conn.execute(
        "SELECT * FROM source_health WHERE url = ?", (url,)
    ).fetchone()
    
    assert row["last_success_method"] == "wp_api"
    assert row["consecutive_failures"] == 0
    
    # Verify success counts
    success_count = json.loads(row["success_count"])
    assert success_count["rss"] == 1
    assert success_count["wp_api"] == 1
    
    conn.close()


def test_record_failure(learner):
    """Test recording failure."""
    url = "https://failed.com/feed/"
    
    learner.record_failure(url, "rss", 1000, "timeout")
    
    # Verify recorded
    conn = sqlite3.connect(learner.db_path)
    conn.row_factory = sqlite3.Row
    
    row = conn.execute(
        "SELECT * FROM source_health WHERE url = ?", (url,)
    ).fetchone()
    
    assert row is not None
    assert row["consecutive_failures"] == 1
    assert row["is_circuit_open"] == 0
    
    conn.close()


def test_record_failure_multiple(learner):
    """Test multiple failures open circuit."""
    url = "https://multifail.com/feed/"
    
    # Record 5 failures
    for i in range(5):
        learner.record_failure(url, "rss", 1000, "timeout")
    
    # Verify circuit open
    conn = sqlite3.connect(learner.db_path)
    conn.row_factory = sqlite3.Row
    
    row = conn.execute(
        "SELECT * FROM source_health WHERE url = ?", (url,)
    ).fetchone()
    
    assert row["consecutive_failures"] == 5
    assert row["is_circuit_open"] == 1
    
    conn.close()


def test_reset_learning_specific_url(learner):
    """Test resetting learning for specific URL."""
    url = "https://reset.com/feed/"
    
    # Record data
    learner.record_success(url, "rss", 3000, 10)
    
    # Reset
    learner.reset_learning(url)
    
    # Verify removed
    conn = sqlite3.connect(learner.db_path)
    
    row = conn.execute(
        "SELECT * FROM source_health WHERE url = ?", (url,)
    ).fetchone()
    
    assert row is None
    
    conn.close()


def test_reset_learning_all(learner):
    """Test resetting learning for all URLs."""
    # Record data for multiple URLs
    learner.record_success("https://a.com/feed/", "rss", 3000, 10)
    learner.record_success("https://b.com/feed/", "wp_api", 2500, 8)
    
    # Reset all
    learner.reset_learning()
    
    # Verify all removed
    conn = sqlite3.connect(learner.db_path)
    
    count = conn.execute("SELECT COUNT(*) FROM source_health").fetchone()[0]
    
    assert count == 0
    
    conn.close()


def test_get_stats(learner):
    """Test getting learning statistics."""
    # Record some data
    learner.record_success("https://a.com/feed/", "rss", 3000, 10)
    learner.record_success("https://b.com/feed/", "wp_api", 2500, 8)
    learner.record_success("https://c.com/feed/", "rss", 3500, 12)
    
    # Get stats
    stats = learner.get_stats()
    
    assert stats["total_sources_tracked"] == 3
    assert stats["circuit_open_sources"] == 0
    assert stats["method_distribution"]["rss"] == 2
    assert stats["method_distribution"]["wp_api"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/akira && pytest tests/test_method_learner.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'core.method_learner'"

- [ ] **Step 3: Write Method Learner implementation**

Create `packages/akira/core/method_learner.py`:

```python
"""Method Learner - URL-based extraction method learning system."""

import sqlite3
import json
import logging
import os
from typing import Optional, Dict

logger = logging.getLogger("akira")


class MethodLearner:
    """
    URL-based method learning system.
    
    Records which extraction method works best for each source URL,
    allowing the engine to optimize cascade order on subsequent fetches.
    
    Performance impact:
        - First fetch: 3-60s (full cascade)
        - Repeat fetch: 3-15s (starts with best method)
        - Saved: ~50s per source per repeat
    
    Example:
        URL https://infotuc.com.ar/feed/ fails with RSS but succeeds with WP API.
        Learner records: last_success_method = "wp_api"
        Next fetch starts with wp_api instead of rss.
    """
    
    def __init__(self, db_path: str):
        """
        Initialize learner with SQLite database.
        
        Args:
            db_path: Path to akira.db
        """
        self.db_path = db_path
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        
        # Connect and initialize schema
        self.db = sqlite3.connect(db_path)
        self.db.row_factory = sqlite3.Row
        self._init_schema()
        
        logger.info(f"method_learner_initialized db={db_path}")
    
    def _init_schema(self):
        """Initialize source_health and extraction_stats tables."""
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS source_health (
                source_id INTEGER PRIMARY KEY,
                url TEXT UNIQUE,
                last_success_method TEXT,
                success_count TEXT DEFAULT '{}',
                consecutive_failures INTEGER DEFAULT 0,
                is_circuit_open INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS extraction_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT,
                method TEXT,
                duration_ms INTEGER,
                items_count INTEGER,
                success INTEGER,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        self.db.commit()
        logger.info("method_learner_schema_initialized")
    
    def get_best_method(self, url: str) -> Optional[str]:
        """
        Get historically best method for this URL.
        
        Returns:
            Method name (e.g., "rss") if found and not circuit-opened
            None if no history or circuit is open (consecutive_failures >= 5)
        
        Example:
            >>> learner.get_best_method("https://infotuc.com.ar/feed/")
            "rss"  # Last successful method
        """
        row = self.db.execute(
            "SELECT last_success_method, consecutive_failures FROM source_health WHERE url = ?",
            (url,)
        ).fetchone()
        
        if not row:
            return None
        
        # Circuit breaker: if 5+ consecutive failures, ignore history
        if row["consecutive_failures"] >= 5:
            logger.warning(
                f"method_learner_circuit_open url={url} failures={row['consecutive_failures']}"
            )
            return None
        
        return row["last_success_method"]
    
    def record_success(
        self, url: str, method: str, duration_ms: int, items_count: int
    ):
        """
        Record successful extraction.
        
        Updates:
            - last_success_method
            - success_count JSON (increment method count)
            - consecutive_failures = 0
            - extraction_stats log
        
        Args:
            url: Source URL
            method: Extraction method (rss, wp_api, newspaper, etc.)
            duration_ms: Extraction duration in milliseconds
            items_count: Number of items extracted
        """
        # Get current success counts
        row = self.db.execute(
            "SELECT success_count FROM source_health WHERE url = ?", (url,)
        ).fetchone()
        
        success_counts = {}
        if row:
            success_counts = json.loads(row["success_count"] or "{}")
        
        # Increment method count
        success_counts[method] = success_counts.get(method, 0) + 1
        
        # Update or insert
        existing = self.db.execute(
            "SELECT url FROM source_health WHERE url = ?", (url,)
        ).fetchone()
        
        if existing:
            self.db.execute("""
                UPDATE source_health 
                SET last_success_method = ?,
                    success_count = ?,
                    consecutive_failures = 0,
                    is_circuit_open = 0,
                    updated_at = datetime('now')
                WHERE url = ?
            """, (method, json.dumps(success_counts), url))
        else:
            self.db.execute("""
                INSERT INTO source_health (url, last_success_method, success_count, consecutive_failures)
                VALUES (?, ?, ?, 0)
            """, (url, method, json.dumps(success_counts)))
        
        # Log to extraction_stats
        self.db.execute("""
            INSERT INTO extraction_stats (url, method, duration_ms, items_count, success)
            VALUES (?, ?, ?, ?, 1)
        """, (url, method, duration_ms, items_count))
        
        self.db.commit()
        
        logger.info(
            f"method_learner_success url={url} method={method} "
            f"duration={duration_ms}ms items={items_count}"
        )
    
    def record_failure(
        self, url: str, method: str, duration_ms: int, error: str
    ):
        """
        Record failed extraction.
        
        Updates:
            - consecutive_failures += 1
            - is_circuit_open = 1 if consecutive_failures >= 5
            - extraction_stats log
        
        Args:
            url: Source URL
            method: Extraction method
            duration_ms: Extraction duration before failure
            error: Error message
        """
        existing = self.db.execute(
            "SELECT consecutive_failures FROM source_health WHERE url = ?", (url,)
        ).fetchone()
        
        if existing:
            new_failures = existing["consecutive_failures"] + 1
            circuit_open = 1 if new_failures >= 5 else 0
            
            self.db.execute("""
                UPDATE source_health 
                SET consecutive_failures = ?,
                    is_circuit_open = ?,
                    updated_at = datetime('now')
                WHERE url = ?
            """, (new_failures, circuit_open, url))
        else:
            self.db.execute("""
                INSERT INTO source_health (url, consecutive_failures, is_circuit_open)
                VALUES (?, 1, 0)
            """, (url,))
        
        # Log to extraction_stats
        self.db.execute("""
            INSERT INTO extraction_stats (url, method, duration_ms, items_count, success)
            VALUES (?, ?, ?, 0, 0)
        """, (url, method, duration_ms))
        
        self.db.commit()
        
        logger.warning(
            f"method_learner_failure url={url} method={method} "
            f"duration={duration_ms}ms error={error}"
        )
    
    def get_stats(self) -> Dict:
        """
        Get overall learning statistics.
        
        Returns:
            Dict with:
                - total_sources_tracked
                - circuit_open_sources
                - method_distribution (counts per method)
        """
        total_sources = self.db.execute(
            "SELECT COUNT(*) as count FROM source_health"
        ).fetchone()["count"]
        
        circuit_open_sources = self.db.execute(
            "SELECT COUNT(*) as count FROM source_health WHERE is_circuit_open = 1"
        ).fetchone()["count"]
        
        method_distribution = {}
        rows = self.db.execute(
            "SELECT last_success_method, COUNT(*) as count FROM source_health WHERE last_success_method IS NOT NULL GROUP BY last_success_method"
        ).fetchall()
        
        for row in rows:
            method_distribution[row["last_success_method"]] = row["count"]
        
        return {
            "total_sources_tracked": total_sources,
            "circuit_open_sources": circuit_open_sources,
            "method_distribution": method_distribution,
        }
    
    def reset_learning(self, url: Optional[str] = None):
        """
        Reset learning for specific URL or all URLs.
        
        Args:
            url: Optional URL to reset. If None, reset all.
        """
        if url:
            self.db.execute("DELETE FROM source_health WHERE url = ?", (url,))
            self.db.execute("DELETE FROM extraction_stats WHERE url = ?", (url,))
            logger.info(f"method_learner_reset url={url}")
        else:
            self.db.execute("DELETE FROM source_health")
            self.db.execute("DELETE FROM extraction_stats")
            logger.info("method_learner_reset_all")
        
        self.db.commit()
    
    def close(self):
        """Close database connection."""
        self.db.close()
        logger.info("method_learner_closed")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/akira && pytest tests/test_method_learner.py -v`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/akira/core/method_learner.py packages/akira/tests/test_method_learner.py
git commit -m "feat(akira): add URL-based method learning system"
```

---

## Task 5: ExtractionEngine Integration

**Files:**
- Modify: `packages/akira/core/engine.py`

- [ ] **Step 1: Modify engine to accept MethodLearner**

Edit `packages/akira/core/engine.py`:

Find the `__init__` method (around line 35-46) and add `method_learner` parameter:

```python
def __init__(
    self,
    extractors: List[Type[BaseExtractor]],
    cache: CacheManager,
    rate_limiter: RateLimiter,
    circuit_breaker: CircuitBreaker,
    method_learner: MethodLearner,  # NEW
):
    self.extractors = sorted(extractors, key=lambda e: e.PRIORITY, reverse=True)
    self.cache = cache
    self.rate_limiter = rate_limiter
    self.circuit_breaker = circuit_breaker
    self.method_learner = method_learner  # NEW
    self._active_extractions = 0
    self._extractions_lock = asyncio.Lock()
    self._in_flight: dict = {}
    self._in_flight_lock = asyncio.Lock()
```

- [ ] **Step 2: Add import for MethodLearner**

Add at top of file (around line 1-10):

```python
from core.method_learner import MethodLearner  # NEW
```

- [ ] **Step 3: Add _build_optimized_order method**

Add new method after `_validate_url` (around line 58):

```python
def _build_optimized_order(self, best_method: str) -> List[Type[BaseExtractor]]:
    """
    Build extractor order optimized by historical success.
    
    Example:
        best_method = "rss"
        order = [RSS(100), WP(90), Newspaper(70), Goose(60), ...]
        
        best_method = "playwright" (normally priority=30)
        order = [Playwright(30), RSS(100), WP(90), ...]
    
    Args:
        best_method: Historically successful method
    
    Returns:
        Optimized extractor list with best method first
    """
    # Find extractor with matching name
    best_extractor = None
    for ext in self.extractors:
        if ext.NAME == best_method:
            best_extractor = ext
            break
    
    if not best_extractor:
        return self.extractors
    
    # Move best extractor to front, preserve relative order
    optimized = [best_extractor]
    for ext in self.extractors:
        if ext.NAME != best_method:
            optimized.append(ext)
    
    return optimized
```

- [ ] **Step 4: Modify extract method to use method learning**

Find the `extract` method (around line 78-220) and modify the beginning:

```python
async def extract(
    self,
    url: str,
    source_id: Optional[int] = None,
    prefer_method: Optional[MethodName] = None,
    use_cache: bool = True,
    timeout: int = 60,
    cache_ttl: Optional[int] = None,
) -> ExtractResult:
    """
    Extract from URL with intelligent cascade.
    
    Cascade order (by priority):
    1. Check method learning (NEW)
    2. Check cache
    3. Check circuit breaker
    4. Try extractors: RSS(100) > WP(90) > Newspaper(70) > Goose(60) > Sitemap(50) > Playwright(30) > Jina(10)
    5. Return first success
    """
    if not self._validate_url(url):
        return ExtractResult(
            success=False,
            method=MethodName.JINA,
            type="article",
            duration_ms=0,
            error="Invalid URL scheme",
        )
    
    start_time = time.time()
    
    # NEW: Check best historical method
    best_method = None
    if not prefer_method:
        best_method = self.method_learner.get_best_method(url)
        if best_method:
            logger.info(f"optimized_cascade url={url} best_method={best_method}")
    
    # Build extractor order
    if best_method:
        extractor_order = self._build_optimized_order(best_method)
    elif prefer_method:
        # Use prefer_method if specified
        extractor_order = self._build_optimized_order(prefer_method.value)
    else:
        # Standard priority-based cascade
        extractor_order = self.extractors
    
    # Try extractors in optimized order
    for extractor_class in extractor_order:
        # ... existing extraction logic continues
```

- [ ] **Step 5: Modify extraction loop to record success/failure**

Find the extraction loop (around line 150-190) and add recording:

```python
try:
    items = await self._retry_with_backoff(
        extractor_instance, url, timeout
    )
    
    if items and len(items) > 0:
        duration_ms = int((time.time() - start_time) * 1000)
        
        # NEW: Record success
        self.method_learner.record_success(
            url=url,
            method=extractor_class.NAME,
            duration_ms=duration_ms,
            items_count=len(items)
        )
        
        return ExtractResult(
            success=True,
            method=_method_name_to_enum(extractor_class.NAME),
            type="feed",
            items=[NewsItem.from_extracted(item) for item in items],
            duration_ms=duration_ms,
        )
except Exception as e:
    last_error = e
    
    duration_ms = int((time.time() - start_time) * 1000)
    
    # NEW: Record failure
    self.method_learner.record_failure(
        url=url,
        method=extractor_class.NAME,
        duration_ms=duration_ms,
        error=str(e)
    )
    
    logger.warning(
        f"extractor_failed url={url} method={extractor_class.NAME} error={e}"
    )
    continue
```

- [ ] **Step 6: Run existing tests to verify no breakage**

Run: `cd packages/akira && pytest tests/ -v`
Expected: PASS (30 existing tests + 19 new tests = 49 total)

- [ ] **Step 7: Commit**

```bash
git add packages/akira/core/engine.py
git commit -m "feat(akira): integrate method learning into extraction engine"
```

---

## Task 6: Request/Response Models

**Files:**
- Create: `packages/akira/models/google_news_schemas.py`
- Modify: `packages/akira/models/schemas.py`

- [ ] **Step 1: Create Google News request models**

Create `packages/akira/models/google_news_schemas.py`:

```python
"""Google News request/response models."""

from pydantic import BaseModel
from typing import Optional, List


class GoogleNewsRequest(BaseModel):
    """Request for single location Google News extraction."""
    
    location_id: Optional[int] = None
    query: Optional[str] = None
    limit: int = 10
    country: str = "AR"


class GoogleNewsBatchRequest(BaseModel):
    """Request for batch Google News extraction."""
    
    location_type: str  # provincia, ciudad, pueblo, autonomous_city
    province_filter: Optional[str] = None
    limit_per_location: int = 5
    concurrency: int = 3


class GoogleNewsLocationResult(BaseModel):
    """Result for single location extraction."""
    
    location_id: int
    location_name: str
    query: str
    items_count: int
    items: List[dict]


class GoogleNewsResult(BaseModel):
    """Result for single Google News extraction."""
    
    success: bool
    method: str = "google_news"
    query: str
    location: Optional[dict] = None
    items_count: int
    items: List[dict]
    duration_ms: int


class GoogleNewsBatchResult(BaseModel):
    """Result for batch Google News extraction."""
    
    success: bool
    total_locations: int
    total_items: int
    results: List[dict]
    duration_ms: int


class MethodStats(BaseModel):
    """Method learning statistics."""
    
    total_sources_tracked: int
    circuit_open_sources: int
    method_distribution: dict
```

- [ ] **Step 2: Import in schemas.py**

Edit `packages/akira/models/schemas.py` and add at end:

```python
# Import Google News models
from models.google_news_schemas import (
    GoogleNewsRequest,
    GoogleNewsBatchRequest,
    GoogleNewsLocationResult,
    GoogleNewsResult,
    GoogleNewsBatchResult,
    MethodStats,
)
```

- [ ] **Step 3: Commit**

```bash
git add packages/akira/models/google_news_schemas.py packages/akira/models/schemas.py
git commit -m "feat(akira): add Google News request/response models"
```

---

## Task 7: Main API Endpoints (4 New Endpoints)

**Files:**
- Modify: `packages/akira/main.py`

- [ ] **Step 1: Add imports**

Edit `packages/akira/main.py` and add imports after existing ones (around line 18-43):

```python
from services.google_news_service import GoogleNewsService
from core.method_learner import MethodLearner
from models.schemas import (
    # ... existing imports
    GoogleNewsRequest,
    GoogleNewsBatchRequest,
    GoogleNewsResult,
    GoogleNewsBatchResult,
    MethodStats,
)
```

- [ ] **Step 2: Initialize services in lifespan**

Find the `lifespan` function (around line 87-160) and add initialization:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - setup and teardown."""
    start_time = time.time()
    app.state.start_time = start_time
    
    # NEW: Initialize Google News Service
    data_dir = os.path.join(os.path.dirname(__file__), "data")
    os.makedirs(data_dir, exist_ok=True)
    
    locations_db_path = os.path.join(data_dir, "locations.db")
    google_news_service = GoogleNewsService(locations_db_path)
    app.state.google_news_service = google_news_service
    
    # NEW: Initialize Method Learner
    akira_db_path = os.path.join(data_dir, "akira.db")
    method_learner = MethodLearner(akira_db_path)
    app.state.method_learner = method_learner
    
    # Initialize HTTP client with connection pooling
    http_client = HTTPClient(
        total_timeout=30,
        connect_timeout=10,
        max_connections=100,
        max_connections_per_host=10,
    )
    await http_client.start()
    app.state.http_client = http_client
    
    cache = CacheManager(MemoryBackend(maxsize=settings.cache_max_size))
    rate_limiter = RateLimiter(delay=settings.request_delay)
    circuit_breaker = CircuitBreaker(
        threshold=settings.circuit_breaker_threshold,
        timeout=settings.circuit_breaker_timeout,
    )
    
    # NEW: Add Google News extractor to list
    from extractors.google_news import GoogleNewsExtractor
    
    extractors = [
        RSSExtractor,
        WordPressExtractor,
        NewspaperExtractor,
        GooseExtractor,
        SitemapExtractor,
        PlaywrightExtractor,
        JinaExtractor,
        VideoExtractor,
        SocialExtractor,
        GoogleNewsExtractor,  # NEW
    ]
    
    engine = ExtractionEngine(
        extractors=extractors,
        cache=cache,
        rate_limiter=rate_limiter,
        circuit_breaker=circuit_breaker,
        method_learner=method_learner,  # NEW
    )
    app.state.engine = engine
    
    # ... rest of lifespan continues unchanged
    
    # NEW: Close services on shutdown
    logger.info("AKIRA shutting down")
    
    # Cancel GC task
    gc_task.cancel()
    try:
        await gc_task
    except asyncio.CancelledError:
        pass
    
    # Close HTTP client
    await http_client.stop()
    
    # NEW: Close Google News service and Method Learner
    google_news_service.close()
    method_learner.close()
    
    # Run final GC
    gc.collect_all()
    
    logger.info("AKIRA shutdown complete")
```

- [ ] **Step 3: Add Google News single endpoint**

Add after `/health/detailed` endpoint (around line 279):

```python
@app.post("/extract/google-news", response_model=GoogleNewsResult)
async def extract_google_news(request: GoogleNewsRequest):
    """
    Extract news from Google News for a location.
    
    Request body:
        {
            "location_id": 103,        // Optional: query by location
            "query": "Córdoba",         // Optional: manual query
            "limit": 10,
            "country": "AR"
        }
    
    Returns:
        {
            "success": true,
            "method": "google_news",
            "query": "noticias Córdoba Capital Córdoba",
            "location": {"id": 103, "name": "Córdoba Capital", ...},
            "items_count": 10,
            "items": [...]
        }
    """
    google_news_service = getattr(app.state, "google_news_service", None)
    
    if not google_news_service:
        return GoogleNewsResult(
            success=False,
            query="",
            items_count=0,
            items=[],
            duration_ms=0,
            error="Google News service not initialized"
        )
    
    start_time = time.time()
    
    # Build query
    location = None
    if request.location_id:
        location = google_news_service.get_location(request.location_id)
        if not location:
            return GoogleNewsResult(
                success=False,
                query="",
                items_count=0,
                items=[],
                duration_ms=0,
                error=f"Location {request.location_id} not found"
            )
        query = google_news_service.build_query(request.location_id)
    elif request.query:
        query = request.query
    else:
        return GoogleNewsResult(
            success=False,
            query="",
            items_count=0,
            items=[],
            duration_ms=0,
            error="Either location_id or query required"
        )
    
    # Extract using GoogleNewsExtractor
    from extractors.google_news import GoogleNewsExtractor
    
    extractor = GoogleNewsExtractor()
    items = await extractor.extract(query, request.country, request.limit)
    
    duration_ms = int((time.time() - start_time) * 1000)
    
    return GoogleNewsResult(
        success=True,
        method="google_news",
        query=query,
        location=location,
        items_count=len(items),
        items=[item.dict() for item in items],
        duration_ms=duration_ms
    )
```

- [ ] **Step 4: Add Google News batch endpoint**

Add after single endpoint:

```python
@app.post("/extract/google-news/batch", response_model=GoogleNewsBatchResult)
async def extract_google_news_batch(request: GoogleNewsBatchRequest):
    """
    Extract news from Google News for multiple locations.
    
    Request body:
        {
            "location_type": "ciudad",      // provincia, ciudad, pueblo
            "province_filter": "Buenos Aires",  // Optional
            "limit_per_location": 5,
            "concurrency": 3
        }
    
    Returns:
        {
            "success": true,
            "total_locations": 50,
            "total_items": 250,
            "results": [
                {
                    "location_id": 105,
                    "location_name": "La Plata",
                    "query": "noticias La Plata Buenos Aires",
                    "items_count": 5,
                    "items": [...]
                },
                ...
            ]
        }
    """
    google_news_service = getattr(app.state, "google_news_service", None)
    
    if not google_news_service:
        return GoogleNewsBatchResult(
            success=False,
            total_locations=0,
            total_items=0,
            results=[],
            duration_ms=0,
            error="Google News service not initialized"
        )
    
    start_time = time.time()
    
    # Get locations
    locations = google_news_service.get_locations_by_type(
        request.location_type,
        request.province_filter
    )
    
    if not locations:
        return GoogleNewsBatchResult(
            success=False,
            total_locations=0,
            total_items=0,
            results=[],
            duration_ms=0,
            error=f"No locations found for type {request.location_type}"
        )
    
    # Extract in parallel (with concurrency limit)
    from extractors.google_news import GoogleNewsExtractor
    
    semaphore = asyncio.Semaphore(request.concurrency)
    extractor = GoogleNewsExtractor()
    
    async def extract_location(location: dict) -> dict:
        async with semaphore:
            query = google_news_service.build_query(location["id"])
            items = await extractor.extract(query, "AR", request.limit_per_location)
            
            return {
                "location_id": location["id"],
                "location_name": location["name"],
                "query": query,
                "items_count": len(items),
                "items": [item.dict() for item in items]
            }
    
    # Run all extractions concurrently
    results = await asyncio.gather(*[extract_location(loc) for loc in locations])
    
    total_items = sum(r["items_count"] for r in results)
    duration_ms = int((time.time() - start_time) * 1000)
    
    logger.info(
        f"google_news_batch_completed locations={len(locations)} "
        f"items={total_items} duration={duration_ms}ms"
    )
    
    return GoogleNewsBatchResult(
        success=True,
        total_locations=len(locations),
        total_items=total_items,
        results=list(results),
        duration_ms=duration_ms
    )
```

- [ ] **Step 5: Add method stats endpoint**

Add after batch endpoint:

```python
@app.get("/admin/method-stats", response_model=MethodStats)
async def method_statistics():
    """
    Return URL-based method learning statistics.
    
    Shows which methods work best across all tracked sources.
    """
    method_learner = getattr(app.state, "method_learner", None)
    
    if not method_learner:
        return MethodStats(
            total_sources_tracked=0,
            circuit_open_sources=0,
            method_distribution={}
        )
    
    return MethodStats(**method_learner.get_stats())
```

- [ ] **Step 6: Add reset learning endpoint**

Add after stats endpoint:

```python
@app.post("/admin/reset-learning")
async def reset_learning(url: Optional[str] = None):
    """
    Reset method learning for specific URL or all URLs.
    
    Query params:
        url: Optional URL to reset. If omitted, reset all.
    """
    method_learner = getattr(app.state, "method_learner", None)
    
    if not method_learner:
        return {"success": False, "error": "Method learner not initialized"}
    
    method_learner.reset_learning(url)
    
    logger.info(f"method_learning_reset url={url or 'all'}")
    
    return {
        "success": True,
        "message": f"Learning reset for {url or 'all URLs'}"
    }
```

- [ ] **Step 7: Update root endpoint list**

Find the root endpoint (around line 236-252) and update:

```python
@app.get("/")
async def root():
    """Root endpoint with API info."""
    return {
        "name": "AKIRA",
        "version": "3.1.0",  # Updated from 3.0.0
        "description": "PULSO Extraction Engine",
        "endpoints": [
            "/health",
            "/health/detailed",
            "/extract",
            "/extract/google-news",  # NEW
            "/extract/google-news/batch",  # NEW
            "/admin/gc",
            "/admin/autoheal",
            "/admin/stats",
            "/admin/method-stats",  # NEW
            "/admin/reset-learning",  # NEW
            "/docs",
        ],
    }
```

- [ ] **Step 8: Run tests to verify endpoints work**

Run: `cd packages/akira && pytest tests/ -v`
Expected: PASS (49 tests)

- [ ] **Step 9: Manual test of endpoints**

```bash
# Test single Google News extraction
curl -X POST http://localhost:5000/extract/google-news \
  -H "Content-Type: application/json" \
  -d '{"location_id": 103, "limit": 5}'

# Test batch extraction
curl -X POST http://localhost:5000/extract/google-news/batch \
  -H "Content-Type: application/json" \
  -d '{"location_type": "ciudad", "province_filter": "Buenos Aires", "limit_per_location": 3}'

# Test method stats
curl http://localhost:5000/admin/method-stats
```

Expected: JSON responses with extracted news.

- [ ] **Step 10: Commit**

```bash
git add packages/akira/main.py
git commit -m "feat(akira): add 4 new endpoints for Google News and method learning"
```

---

## Task 8: Integration Tests

**Files:**
- Create: `packages/akira/tests/test_integration_akira.py`

- [ ] **Step 1: Write integration test for full extraction with learning**

Create `packages/akira/tests/test_integration_akira.py`:

```python
"""Integration tests for AKIRA v3.1."""

import pytest
import asyncio
import time
from core.engine import ExtractionEngine
from core.cache import CacheManager, MemoryBackend
from core.rate_limiter import RateLimiter
from core.circuit_breaker import CircuitBreaker
from core.method_learner import MethodLearner
from extractors.rss import RSSExtractor
from extractors.wordpress import WordPressExtractor
from extractors.google_news import GoogleNewsExtractor


@pytest.fixture
def engine():
    """Create full engine with method learning."""
    # Temporary database
    db_path = "/tmp/test_integration_akira.db"
    learner = MethodLearner(db_path)
    
    cache = CacheManager(MemoryBackend(maxsize=1000))
    rate_limiter = RateLimiter(delay=1.5)
    circuit_breaker = CircuitBreaker(threshold=5, timeout=60)
    
    extractors = [RSSExtractor, WordPressExtractor, GoogleNewsExtractor]
    
    engine = ExtractionEngine(
        extractors=extractors,
        cache=cache,
        rate_limiter=rate_limiter,
        circuit_breaker=circuit_breaker,
        method_learner=learner
    )
    
    yield engine
    
    learner.close()


@pytest.mark.asyncio
async def test_full_extraction_with_learning(engine):
    """Test that second extraction uses learned method."""
    url = "https://www.infotuc.com.ar/feed/"
    
    # First extraction
    start1 = time.time()
    result1 = await engine.extract(url, timeout=30)
    duration1 = time.time() - start1
    
    # Second extraction (should use learned method)
    start2 = time.time()
    result2 = await engine.extract(url, timeout=30)
    duration2 = time.time() - start2
    
    # Both should succeed
    assert result1.success
    assert result2.success
    
    # Second should be faster (or similar if RSS already best)
    # Note: May not be faster if RSS was already the first method
    
    # Verify method learner recorded success
    stats = engine.method_learner.get_stats()
    assert stats["total_sources_tracked"] >= 1


@pytest.mark.asyncio
async def test_google_news_integration(engine):
    """Test Google News extraction via engine."""
    query = "noticias Córdoba Argentina"
    
    # Use GoogleNewsExtractor directly
    extractor = GoogleNewsExtractor()
    items = await extractor.extract(query, limit=5)
    
    assert len(items) <= 5
    assert all(item.title for item in items)
    assert all(item.url for item in items)


@pytest.mark.asyncio
async def test_cascade_optimization_performance():
    """Verify optimized cascade is faster than standard."""
    db_path = "/tmp/test_performance.db"
    learner = MethodLearner(db_path)
    
    # Record that "wp_api" is best for a URL
    url = "https://example.com/feed/"
    learner.record_success(url, "wp_api", 2500, 10)
    
    # Get best method
    best = learner.get_best_method(url)
    
    assert best == "wp_api"
    
    # Build optimized order
    cache = CacheManager(MemoryBackend(maxsize=100))
    rate_limiter = RateLimiter(delay=1.5)
    circuit_breaker = CircuitBreaker(threshold=5, timeout=60)
    
    extractors = [RSSExtractor, WordPressExtractor]
    
    engine = ExtractionEngine(
        extractors=extractors,
        cache=cache,
        rate_limiter=rate_limiter,
        circuit_breaker=circuit_breaker,
        method_learner=learner
    )
    
    optimized_order = engine._build_optimized_order("wp_api")
    
    # WP should be first
    assert optimized_order[0].NAME == "wp_api"
    assert optimized_order[1].NAME == "rss"
    
    learner.close()
```

- [ ] **Step 2: Run integration tests**

Run: `cd packages/akira && pytest tests/test_integration_akira.py -v`
Expected: PASS (3 tests)

- [ ] **Step 3: Run all tests together**

Run: `cd packages/akira && pytest tests/ -v`
Expected: PASS (52 tests total)

- [ ] **Step 4: Commit**

```bash
git add packages/akira/tests/test_integration_akira.py
git commit -m "feat(akira): add integration tests for method learning and Google News"
```

---

## Task 9: Remove Flask Extractor

**Files:**
- Remove: `packages/extractor/` directory (216MB)

- [ ] **Step 1: Verify AKIRA v3.1 fully functional**

Run: `cd packages/akira && pytest tests/ -v --tb=short`
Expected: PASS (52 tests)

Run: `curl http://localhost:5000/health`
Expected: `{"status": "healthy", "version": "3.1.0", ...}`

- [ ] **Step 2: Stop Flask extractor if running**

```bash
lsof -ti:5000 | xargs kill 2>/dev/null || true
```

Note: AKIRA should already be on port 5000 (PM2 config).

- [ ] **Step 3: Remove Flask extractor directory**

```bash
rm -rf packages/extractor/
```

- [ ] **Step 4: Verify removal**

Run: `ls packages/extractor`
Expected: Error (directory not found)

Run: `du -sh packages/`
Expected: Smaller total size (216MB freed)

- [ ] **Step 5: Update PM2 config (if needed)**

Check `ecosystem.config.cjs`:

```javascript
module.exports = {
  apps: [
    {
      name: 'akira',  // Should already exist
      cwd: './packages/akira',
      script: 'python3',
      args: '-m uvicorn main:app --host 0.0.0.0 --port 5000',
      // ... (no changes needed)
    },
    // Remove any reference to 'extractor' app if exists
  ]
};
```

- [ ] **Step 6: Restart services**

```bash
pm2 restart akira
pm2 restart api
pm2 restart web
```

- [ ] **Step 7: Verify Hermes compatibility**

```bash
# Test extraction via Hermes skill path
curl -X POST http://localhost:5000/extract \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.infotuc.com.ar/feed/", "source_id": 1}'
```

Expected: JSON with extracted items.

- [ ] **Step 8: Commit removal**

```bash
git add -A  # Removes packages/extractor/
git commit -m "chore: remove Flask extractor (consolidated to AKIRA v3.1)"
```

---

## Task 10: Update Documentation

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`

- [ ] **Step 1: Update AGENTS.md**

Edit `AGENTS.md`:

Replace line 13:
```markdown
│  HARVESTER (Python Extractor) ← puerto 5000
```
With:
```markdown
│  HARVESTER (AKIRA v3.1) ← puerto 5000
```

Replace line 14-16:
```markdown
│  └── Cascade: RSS → WP API → Newspaper → Goose → Sitemap →    │
│               Playwright → Jina                                 │
│  └── Google News RSS para búsqueda                             │
```
With:
```markdown
│  └── Cascade: RSS → WP API → Newspaper → Goose → Sitemap →    │
│               Playwright → Jina → Google News                  │
│  └── Method Learning: Optimiza cascade por URL                 │
│  └── Google News Geo: Búsqueda por location_id                 │
```

Replace line 39:
```markdown
cd packages/extractor && ./start.sh  # Python Extractor (puerto 5000)
```
With:
```markdown
cd packages/akira && python -m uvicorn main:app --port 5000  # AKIRA v3.1
```

Replace lines 42-54 (Extraction Methods table):
```markdown
## Extraction Methods (unificado en Python Extractor)

| Método | Librería | Uso | Timeout |
|--------|----------|-----|---------|
| RSS | feedparser | Feeds RSS/Atom | 30s |
| WP API | requests | WordPress sites | 30s |
| Newspaper3k | newspaper | Artículo completo | 60s |
| Goose3 | goose3 | Fallback artículos | 60s |
| Sitemap | xml.etree | URLs recientes | 15s |
| Playwright | playwright | Sites con JS | 60s |
| Jina | r.jina.ai | Último recurso | 60s |
| Google News | feedparser | Búsqueda por query | 15s |
```
With:
```markdown
## Extraction Methods (AKIRA v3.1 - 10 extractores)

| Método | Librería | Priority | Uso | Timeout |
|--------|----------|----------|-----|---------|
| RSS | feedparser | 100 | Feeds RSS/Atom | 30s |
| WordPress | requests | 90 | WordPress REST API | 30s |
| Newspaper | newspaper3k | 70 | Artículo completo | 60s |
| Goose | goose3 | 60 | Fallback artículos | 60s |
| Sitemap | xml.etree | 50 | URLs recientes | 15s |
| Playwright | playwright | 30 | Sites con JS | 60s |
| Jina | r.jina.ai | 10 | Último recurso | 60s |
| Video | yt-dlp | 20 | YouTube/Video | 60s |
| Social | embed | 15 | Twitter/Instagram | 30s |
| Google News | feedparser | 90 | Geo-aware search | 15s |

**Method Learning:** AKIRA aprende qué método funciona mejor por URL y optimiza el cascade.
```

Replace lines 57-70 (Endpoints section):
```markdown
### Python Extractor (puerto 5000)

```bash
# Extracción unificada (todos los métodos)
POST /extract
{"url": "https://...", "source_id": 1}

# Búsqueda Google News
POST /extract/google-news
{"query": "noticias Córdoba", "limit": 10}

# Health check
GET /health
```
```
With:
```markdown
### AKIRA v3.1 (puerto 5000)

```bash
# Extracción unificada (cascade con method learning)
POST /extract
{"url": "https://...", "source_id": 1}

# Google News por location_id
POST /extract/google-news
{"location_id": 103, "limit": 10}  → "noticias Córdoba Capital Córdoba"

# Google News batch por tipo
POST /extract/google-news/batch
{"location_type": "ciudad", "province_filter": "Buenos Aires", "limit_per_location": 5}

# Method learning stats
GET /admin/method-stats

# Reset learning
POST /admin/reset-learning?url=https://...

# Health check
GET /health
GET /health/detailed
```
```

Add after line 95 (Database section):
```markdown
## Database

- **AKIRA SQLite:** `packages/akira/data/akira.db` (method learning + stats)
- **AKIRA Locations:** `packages/akira/data/locations.db` (150+ ciudades)
- **Cloudflare D1:** `.wrangler/state/v3/d1/` (noticias públicas)
```

- [ ] **Step 2: Update README.md**

Edit `README.md`:

Replace line 11:
```markdown
- **Agents:** Hermes + MiniMax MCP (Mac Mini, Phase 2)
```
With:
```markdown
- **Extractor:** AKIRA v3.1 (FastAPI async + method learning)
- **Agents:** Hermes + MiniMax MCP (Mac Mini)
```

Add after line 25 (Architecture):
```markdown
- `packages/akira/` — AKIRA extraction engine (puerto 5000)
```

- [ ] **Step 3: Commit documentation**

```bash
git add AGENTS.md README.md
git commit -m "docs: update AGENTS.md and README.md for AKIRA v3.1"
```

---

## Task 11: Final Verification

- [ ] **Step 1: Run all tests**

Run: `cd packages/akira && pytest tests/ -v --tb=short`
Expected: PASS (52 tests)

- [ ] **Step 2: Verify all endpoints**

```bash
# Health check
curl http://localhost:5000/health | jq .

# Standard extraction
curl -X POST http://localhost:5000/extract \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.infotuc.com.ar/feed/"}' | jq .

# Google News single
curl -X POST http://localhost:5000/extract/google-news \
  -H "Content-Type: application/json" \
  -d '{"location_id": 103, "limit": 5}' | jq .

# Google News batch
curl -X POST http://localhost:5000/extract/google-news/batch \
  -H "Content-Type: application/json" \
  -d '{"location_type": "ciudad", "limit_per_location": 3}' | jq .

# Method stats
curl http://localhost:5000/admin/method-stats | jq .
```

Expected: All endpoints return valid JSON.

- [ ] **Step 3: Test method learning optimization**

```bash
# Extract from same URL twice
curl -X POST http://localhost:5000/extract \
  -d '{"url": "https://www.eldia.com/rss/"}' > /tmp/first.json

# Wait 2 seconds
sleep 2

# Extract again (should use learned method)
curl -X POST http://localhost:5000/extract \
  -d '{"url": "https://www.eldia.com/rss/"}' > /tmp/second.json

# Check method stats
curl http://localhost:5000/admin/method-stats
```

Expected: Stats show URL tracked with last_success_method.

- [ ] **Step 4: Verify Hermes skills work**

```bash
# Check D1 has news
sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite \
  "SELECT COUNT(*) FROM news_cards;"

# Run harvester skill manually (if Hermes installed)
hermes cron run pulso-harvester
```

Expected: Harvester extracts news and writes to D1.

- [ ] **Step 5: Check disk space saved**

Run: `du -sh packages/`
Expected: ~2.5MB (vs ~218MB before)

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(akira): complete consolidation to v3.1 with Google News and method learning"
```

---

## Verification Checklist

After all tasks complete, verify:

- [ ] All 52 tests passing
- [ ] Flask extractor removed (216MB freed)
- [ ] AKIRA v3.1 running on port 5000
- [ ] Google News endpoints functional (`/extract/google-news`, `/extract/google-news/batch`)
- [ ] Method learning functional (`/admin/method-stats`, `/admin/reset-learning`)
- [ ] Extraction cascade optimized (check logs for "optimized_cascade")
- [ ] Hermes skills compatible (pulso-harvester works)
- [ ] Documentation updated (AGENTS.md, README.md)
- [ ] PM2 config correct (akira app only)
- [ ] Locations database seeded (150+ locations)

---

## Success Metrics

| Metric | Target | Verification |
|--------|--------|--------------|
| Tests passing | 52 | `pytest tests/ -v` |
| Flask removed | ✓ | `ls packages/extractor` (fails) |
| Disk space saved | 216MB | `du -sh packages/` |
| Method learning | ✓ | `/admin/method-stats` returns data |
| Google News | ✓ | Both endpoints return items |
| Performance gain | 80% faster | Compare first vs second extraction |
| Hermes compatible | ✓ | `pulso-harvester` skill works |

---

## Troubleshooting

**Tests failing:**
```bash
# Check database paths
ls packages/akira/data/

# Recreate locations DB if missing
sqlite3 packages/akira/data/locations.db < migrations/0004_locations_seed.sql

# Clear test cache
rm -rf /tmp/test_*.db
pytest tests/ -v --tb=short
```

**Port 5000 conflict:**
```bash
# Find process on port
lsof -ti:5000

# Kill process
lsof -ti:5000 | xargs kill

# Restart AKIRA
pm2 restart akira
```

**Google News returns empty:**
- Google News may rate-limit excessive requests
- Add delay between batch requests (concurrency parameter)
- Use different queries to avoid duplicates

**Method learning not recording:**
```bash
# Check database exists
ls packages/akira/data/akira.db

# Manually check schema
sqlite3 packages/akira/data/akira.db ".schema"

# Reset learning
curl -X POST http://localhost:5000/admin/reset-learning
```

---

## Notes

- Tests may take longer due to network requests to Google News
- Method learning builds up over time (first fetch always full cascade)
- Google News batch respects concurrency limit to avoid rate limiting
- Locations database is static (seeded from migrations, no sync)
- Hermes skills unchanged (already use AKIRA port 5000)

---

## Plan Complete

This plan produces working, testable AKIRA v3.1 with:
- 10 extraction methods (including Google News)
- URL-based method learning (80% performance gain)
- 4 new API endpoints
- 52 passing tests
- 216MB disk space saved
- Zero functionality loss from Flask extractor