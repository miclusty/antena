# AKIRA v3.1 - Flask Extractor Consolidation Design

**Date:** 2026-04-03  
**Status:** Approved  
**Version:** 3.1.0  
**Author:** PULSO Team  

---

## Executive Summary

Complete migration of Flask Extractor (`packages/extractor/`) to AKIRA v3.1 with zero functionality loss. This consolidation eliminates 216MB of legacy code, adds Google News geo-aware extraction, and implements URL-based method learning for performance optimization.

---

## Current State Analysis

### Flask Extractor (Legacy - TO BE REMOVED)
- **Location:** `packages/extractor/pulso_extractor.py` (688 lines)
- **Framework:** Flask
- **Port:** 5000
- **Size:** 216MB (includes venv)
- **Endpoints:** `/extract`, `/extract/google-news`, `/health`

### AKIRA v3.0 (Current - TO BE ENHANCED)
- **Location:** `packages/akira/main.py` (390 lines)
- **Framework:** FastAPI (async)
- **Port:** 5000
- **Tests:** 30 passing
- **Extractors:** 9 (rss, wordpress, newspaper, goose, sitemap, playwright, jina, video, social)

### Hermes Integration
- Skills call AKIRA directly: `http://localhost:5000/extract`
- Scripts write directly to D1 SQLite (no Node.js proxy)
- Skills affected: `pulso-harvester`, `pulso-scout`, `pulso-d1-harvest`

---

## Gap Analysis: Flask Features Missing in AKIRA

| Feature | Flask | AKIRA v3.0 | Migration Required |
|---------|-------|------------|-------------------|
| `/extract` cascade | ✓ | ✓ (9 methods) | Already better |
| `/extract/google-news` | ✓ | ✗ | **ADD endpoint + extractor** |
| URL method learning | ✓ (`get_best_method()`) | ✗ | **ADD MethodLearner class** |
| Source health SQLite | ✓ (`source_health` table) | ✗ | **ADD local SQLite** |
| Success count JSON | ✓ (per URL) | ✗ | **ADD to schema** |
| Rate limiting | ✓ (1.5s/domain) | ✓ (RateLimiter) | Already better |
| Circuit breaker | ✓ (basic) | ✓ (threshold-based) | Already better |
| Health tracking | ✓ (per source) | ✓ (HealthMonitor) | Already better |

---

## Architecture: AKIRA v3.1

### Directory Structure

```
packages/akira/
├── core/
│   ├── engine.py              (MODIFIED - add method learning)
│   ├── method_learner.py      (NEW)
│   ├── rate_limiter.py        (existing)
│   ├── circuit_breaker.py     (existing)
│   ├── cache.py               (existing)
│   ├── health_monitor.py      (existing)
│   ├── garbage_collector.py   (existing)
│   ├── http_client.py         (existing)
│   └── metrics.py             (existing)
├── extractors/
│   ├── base.py                (existing)
│   ├── rss.py                 (existing)
│   ├── wordpress.py           (existing)
│   ├── newspaper.py           (existing)
│   ├── goose.py               (existing)
│   ├── sitemap.py             (existing)
│   ├── playwright.py          (existing)
│   ├── jina.py                (existing)
│   ├── video.py               (existing)
│   ├── social.py              (existing)
│   └── google_news.py         (NEW)
├── services/
│   ├── google_news_service.py (NEW)
│   └── (other services)
├── models/
│   ├── schemas.py             (MODIFIED - add GoogleNewsRequest)
│   └── (other models)
├── data/
│   ├── akira.db               (NEW - source_health + stats)
│   └── locations.db           (NEW - 150+ Argentine locations)
├── tests/
│   ├── test_google_news.py    (NEW)
│   ├── test_method_learning.py (NEW)
│   └── (existing 30 tests)
└── main.py                    (MODIFIED - add Google News endpoints)
```

---

## Component Specifications

### 1. Google News Extractor

**File:** `extractors/google_news.py`

**Purpose:** Extract news from Google News RSS with location-aware queries.

**Implementation:**
```python
class GoogleNewsExtractor(BaseExtractor):
    NAME = "google_news"
    PRIORITY = 90  # Fallback after RSS (100) and WordPress (90)
    
    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        # Not applicable - Google News is query-based, not URL-based
        return False
    
    async def extract(self, query: str, country: str = "AR", limit: int = 10) -> List[ExtractedItem]:
        """
        Extract from Google News RSS search.
        
        Args:
            query: Search query (e.g., "noticias Córdoba")
            country: Country code (default AR)
            limit: Max items to return
        
        Returns:
            List of ExtractedItem with title, url, summary, published_at, source
        """
        import feedparser
        import urllib.parse
        
        encoded_query = urllib.parse.quote(query)
        rss_url = f"https://news.google.com/rss/search?q={encoded_query}&hl=es&gl={country}&ceid=AR:es"
        
        feed = await asyncio.get_event_loop().run_in_executor(
            None, feedparser.parse, rss_url
        )
        
        items = []
        for entry in feed.entries[:limit]:
            items.append(ExtractedItem(
                title=entry.get("title", ""),
                url=entry.get("link", ""),
                summary=entry.get("summary", "")[:300],
                published_at=entry.get("published", ""),
                source=entry.get("source", {}).get("title", ""),
                method=self.NAME
            ))
        
        return items
```

**Dependencies:**
- `feedparser` (already in requirements)
- Query builder from `google_news_service.py`

---

### 2. Google News Service

**File:** `services/google_news_service.py`

**Purpose:** Build location-aware queries for Google News.

**Implementation:**
```python
class GoogleNewsService:
    def __init__(self, locations_db_path: str):
        self.locations_db = sqlite3.connect(locations_db_path)
        self.locations_db.row_factory = sqlite3.Row
    
    def get_location(self, location_id: int) -> dict:
        """Get location from local database."""
        row = self.locations_db.execute(
            "SELECT * FROM locations WHERE id = ?", (location_id,)
        ).fetchone()
        return dict(row) if row else None
    
    def build_query(self, location_id: int) -> str:
        """
        Build Google News query for location.
        
        Examples:
            location_id=101 → "noticias Córdoba Capital Córdoba"
            location_id=3 → "noticias Córdoba" (provincia)
            location_id=1 → "noticias Argentina"
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
    
    def get_locations_by_type(self, type: str, province_filter: Optional[str] = None) -> List[dict]:
        """Get all locations of a specific type."""
        query = "SELECT * FROM locations WHERE type = ?"
        params = [type]
        
        if province_filter:
            query += " AND province = ?"
            params.append(province_filter)
        
        rows = self.locations_db.execute(query, params).fetchall()
        return [dict(row) for row in rows]
    
    def close(self):
        self.locations_db.close()
```

---

### 3. Method Learner

**File:** `core/method_learner.py`

**Purpose:** Track successful extraction methods per URL and optimize cascade order.

**Implementation:**
```python
class MethodLearner:
    """
    URL-based method learning system.
    
    Records which extraction method works best for each source URL,
    allowing the engine to optimize cascade order on subsequent fetches.
    """
    
    def __init__(self, db_path: str):
        self.db = sqlite3.connect(db_path)
        self.db.row_factory = sqlite3.Row
        self._init_schema()
    
    def _init_schema(self):
        """Initialize source_health table."""
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
    
    def get_best_method(self, url: str) -> Optional[str]:
        """
        Get historically best method for this URL.
        
        Returns:
            Method name (e.g., "rss") if found and not circuit-opened
            None if no history or circuit is open (consecutive_failures >= 5)
        """
        row = self.db.execute(
            "SELECT last_success_method, consecutive_failures FROM source_health WHERE url = ?",
            (url,)
        ).fetchone()
        
        if not row:
            return None
        
        # Circuit breaker: if 5+ consecutive failures, ignore history
        if row["consecutive_failures"] >= 5:
            return None
        
        return row["last_success_method"]
    
    def record_success(self, url: str, method: str, duration_ms: int, items_count: int):
        """
        Record successful extraction.
        
        Updates:
            - last_success_method
            - success_count JSON (increment method count)
            - consecutive_failures = 0
            - extraction_stats log
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
    
    def record_failure(self, url: str, method: str, duration_ms: int, error: str):
        """
        Record failed extraction.
        
        Updates:
            - consecutive_failures += 1
            - is_circuit_open = 1 if consecutive_failures >= 5
            - extraction_stats log
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
    
    def get_stats(self) -> dict:
        """Get overall learning statistics."""
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
        """Reset learning for specific URL or all URLs."""
        if url:
            self.db.execute("DELETE FROM source_health WHERE url = ?", (url,))
            self.db.execute("DELETE FROM extraction_stats WHERE url = ?", (url,))
        else:
            self.db.execute("DELETE FROM source_health")
            self.db.execute("DELETE FROM extraction_stats")
        
        self.db.commit()
    
    def close(self):
        self.db.close()
```

---

### 4. ExtractionEngine Integration

**File:** `core/engine.py` (MODIFIED)

**Changes:**
```python
class ExtractionEngine:
    def __init__(
        self,
        extractors: List[Type[BaseExtractor]],
        cache: CacheManager,
        rate_limiter: RateLimiter,
        circuit_breaker: CircuitBreaker,
        method_learner: MethodLearner,  # NEW parameter
    ):
        self.extractors = sorted(extractors, key=lambda e: e.PRIORITY, reverse=True)
        self.cache = cache
        self.rate_limiter = rate_limiter
        self.circuit_breaker = circuit_breaker
        self.method_learner = method_learner  # NEW
        # ... existing attributes
    
    async def extract(self, url: str, ...):
        # NEW: Check best historical method
        best_method = self.method_learner.get_best_method(url)
        
        # NEW: Optimize cascade order
        if best_method:
            # Start with historically successful method
            extractor_order = self._build_optimized_order(best_method)
            logger.info(f"optimized_cascade url={url} best_method={best_method}")
        else:
            # Standard priority-based cascade
            extractor_order = self.extractors
        
        # Try extractors in order
        for extractor_class in extractor_order:
            try:
                # ... existing extraction logic
                
                if result:
                    # NEW: Record success
                    self.method_learner.record_success(
                        url=url,
                        method=extractor_class.NAME,
                        duration_ms=int((time.time() - start_time) * 1000),
                        items_count=len(result)
                    )
                    return result
            except Exception as e:
                # NEW: Record failure
                self.method_learner.record_failure(
                    url=url,
                    method=extractor_class.NAME,
                    duration_ms=int((time.time() - start_time) * 1000),
                    error=str(e)
                )
                continue
    
    def _build_optimized_order(self, best_method: str) -> List[Type[BaseExtractor]]:
        """
        Build extractor order optimized by historical success.
        
        Example:
            best_method = "rss"
            order = [RSS(100), WP(90), Newspaper(70), Goose(60), ...]
            
            best_method = "playwright" (normally priority=30)
            order = [Playwright(30), RSS(100), WP(90), ...]
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

---

### 5. Locations Database

**File:** `data/locations.db`

**Purpose:** Local replica of D1 locations table (150+ Argentine cities/provinces).

**Schema:**
```sql
CREATE TABLE locations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    province TEXT,
    country TEXT DEFAULT 'AR',
    lat REAL,
    lng REAL,
    population INTEGER,
    type TEXT,  -- pais, provincia, ciudad, pueblo, autonomous_city
    parent_id INTEGER,
    FOREIGN KEY (parent_id) REFERENCES locations(id)
);

CREATE INDEX idx_locations_type ON locations(type);
CREATE INDEX idx_locations_province ON locations(province);
```

**Seed Data:**
- Copied from `migrations/0004_locations_seed.sql`
- 23 provinces + CABA + 150+ cities/towns
- Total: ~200 locations

**Initialization:**
```python
# In main.py lifespan
async def lifespan(app: FastAPI):
    # Initialize locations database
    locations_db_path = os.path.join(os.path.dirname(__file__), "data", "locations.db")
    os.makedirs(os.path.dirname(locations_db_path), exist_ok=True)
    
    google_news_service = GoogleNewsService(locations_db_path)
    app.state.google_news_service = google_news_service
    
    # Seed locations if empty
    if google_news_service.get_location(1) is None:
        await _seed_locations(locations_db_path)
    
    # ... existing initialization
```

---

### 6. Main API Endpoints

**File:** `main.py` (MODIFIED)

**New Endpoints:**

#### `/extract/google-news` (Single Location)
```python
@app.post("/extract/google-news")
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
    google_news_service = app.state.google_news_service
    engine = app.state.engine
    
    # Build query
    if request.location_id:
        location = google_news_service.get_location(request.location_id)
        if not location:
            return {"success": False, "error": f"Location {request.location_id} not found"}
        query = google_news_service.build_query(request.location_id)
    elif request.query:
        query = request.query
        location = None
    else:
        return {"success": False, "error": "Either location_id or query required"}
    
    # Extract
    items = await engine.extractors[-1].extract(query, request.country, request.limit)
    
    return {
        "success": True,
        "method": "google_news",
        "query": query,
        "location": location,
        "items_count": len(items),
        "items": [item.dict() for item in items],
        "duration_ms": int((time.time() - start_time) * 1000)
    }
```

#### `/extract/google-news/batch` (Multiple Locations)
```python
@app.post("/extract/google-news/batch")
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
    google_news_service = app.state.google_news_service
    engine = app.state.engine
    
    # Get locations
    locations = google_news_service.get_locations_by_type(
        request.location_type,
        request.province_filter
    )
    
    # Extract in parallel (with concurrency limit)
    semaphore = asyncio.Semaphore(request.concurrency)
    
    async def extract_location(location):
        async with semaphore:
            query = google_news_service.build_query(location["id"])
            items = await engine.extractors[-1].extract(query, "AR", request.limit_per_location)
            return {
                "location_id": location["id"],
                "location_name": location["name"],
                "query": query,
                "items_count": len(items),
                "items": [item.dict() for item in items]
            }
    
    results = await asyncio.gather(*[extract_location(loc) for loc in locations])
    
    total_items = sum(r["items_count"] for r in results)
    
    return {
        "success": True,
        "total_locations": len(locations),
        "total_items": total_items,
        "results": results,
        "duration_ms": int((time.time() - start_time) * 1000)
    }
```

#### `/admin/method-stats` (Learning Statistics)
```python
@app.get("/admin/method-stats")
async def method_statistics():
    """
    Return URL-based method learning statistics.
    
    Shows which methods work best across all tracked sources.
    """
    method_learner = app.state.method_learner
    
    return method_learner.get_stats()
```

#### `/admin/reset-learning` (Reset Learning)
```python
@app.post("/admin/reset-learning")
async def reset_learning(url: Optional[str] = None):
    """
    Reset method learning for specific URL or all URLs.
    """
    method_learner = app.state.method_learner
    
    method_learner.reset_learning(url)
    
    return {
        "success": True,
        "message": f"Learning reset for {url or 'all URLs'}"
    }
```

---

### 7. Request/Response Models

**File:** `models/schemas.py` (MODIFIED)

```python
class GoogleNewsRequest(BaseModel):
    location_id: Optional[int] = None
    query: Optional[str] = None
    limit: int = 10
    country: str = "AR"

class GoogleNewsBatchRequest(BaseModel):
    location_type: str  # provincia, ciudad, pueblo
    province_filter: Optional[str] = None
    limit_per_location: int = 5
    concurrency: int = 3

class GoogleNewsResult(BaseModel):
    success: bool
    method: str = "google_news"
    query: str
    location: Optional[dict] = None
    items_count: int
    items: List[dict]
    duration_ms: int

class GoogleNewsBatchResult(BaseModel):
    success: bool
    total_locations: int
    total_items: int
    results: List[dict]
    duration_ms: int

class MethodStats(BaseModel):
    total_sources_tracked: int
    circuit_open_sources: int
    method_distribution: dict
```

---

## Performance Impact

### Before (Flask)
- **Extraction time per source:** 3-60s (cascade tries all methods)
- **Method learning:** Yes (starts with historical best method)
- **Time saved per repeat fetch:** ~50s (skips failed methods)

### After (AKIRA v3.0 - No Learning)
- **Extraction time per source:** 3-60s (always full cascade)
- **Method learning:** No
- **Repeat fetch penalty:** Always tries all methods

### After (AKIRA v3.1 - With Learning)
- **First extraction:** 3-60s (full cascade)
- **Repeat extraction:** 3-15s (starts with best method)
- **Time saved:** ~50s per source per repeat fetch
- **With 959 sources:** 47,950s saved (~13 hours per harvest cycle)

### Hermes Cron Impact
- **Harvester runs every 30 minutes**
- **Without learning:** Each run takes ~3-5 hours (959 sources × avg 20s)
- **With learning:** Each run takes ~30-60 minutes (959 sources × avg 3s)
- **Improvement:** 80% faster after first successful fetch

---

## Database Paths

| Database | Path | Purpose |
|----------|------|---------|
| AKIRA source_health | `packages/akira/data/akira.db` | URL-based method learning |
| AKIRA locations | `packages/akira/data/locations.db` | 150+ Argentine locations |
| Hermes D1 (wrangler dev) | `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/...sqlite` | Public news data |
| Hermes extractor (legacy) | `$HOME/data/pulso.db` | **TO BE REMOVED** |

---

## Migration Execution Plan

### Phase 1: Add New Components (No Breaking Changes)

**Step 1.1: Create data directories**
```bash
mkdir -p packages/akira/data
```

**Step 1.2: Create locations database**
```python
# Seed from migrations/0004_locations_seed.sql
sqlite3 packages/akira/data/locations.db < migrations/0004_locations_seed.sql
```

**Step 1.3: Implement new components**
- `extractors/google_news.py`
- `services/google_news_service.py`
- `core/method_learner.py`
- Modify `core/engine.py` (add method learning)
- Modify `models/schemas.py` (add request models)
- Modify `main.py` (add endpoints)

**Step 1.4: Write tests**
- `tests/test_google_news.py` (7 tests)
- `tests/test_method_learning.py` (8 tests)
- Integration tests

**Step 1.5: Verify existing tests still pass**
```bash
cd packages/akira && pytest tests/
# Expected: 38 passing (30 existing + 8 new)
```

**Step 1.6: Test Hermes compatibility**
```bash
# Run harvester skill
hermes cron run pulso-harvester

# Verify extraction works
curl -X POST http://localhost:5000/extract \
  -d '{"url": "https://www.infotuc.com.ar/feed/"}'

# Verify method learning works
curl http://localhost:5000/admin/method-stats
```

---

### Phase 2: Verify AKIRA v3.1 Works

**Step 2.1: Full extraction test**
```python
# Test with 50 sources
# First run: full cascade
# Second run: optimized cascade (should be 80% faster)
```

**Step 2.2: Google News test**
```bash
# Single location
curl -X POST http://localhost:5000/extract/google-news \
  -d '{"location_id": 103, "limit": 10}'

# Batch extraction
curl -X POST http://localhost:5000/extract/google-news/batch \
  -d '{"location_type": "ciudad", "province_filter": "Buenos Aires", "limit_per_location": 5}'
```

**Step 2.3: Method learning validation**
```bash
# Extract from same URL twice
# Verify second extraction starts with best method
# Check /admin/method-stats for learning data
```

---

### Phase 3: Remove Flask Extractor

**Step 3.1: Stop Flask extractor process**
```bash
pm2 stop extractor  # If running
# Or: lsof -ti:5000 | xargs kill
```

**Step 3.2: Remove Flask extractor directory**
```bash
rm -rf packages/extractor/  # 216MB freed
```

**Step 3.3: Update PM2 configuration**
```javascript
// ecosystem.config.cjs - already has akira, no changes needed
module.exports = {
  apps: [
    {
      name: 'akira',  // ✅ Already configured
      cwd: './packages/akira',
      script: 'python3',
      args: '-m uvicorn main:app --host 0.0.0.0 --port 5000',
      // ...
    },
    // ❌ Remove: extractor app (if exists)
  ]
};
```

**Step 3.4: Update documentation**
- `AGENTS.md`: Replace "Python Extractor" → "AKIRA v3.1"
- `README.md`: Update architecture diagram
- Scripts: Update references to `packages/extractor` → `packages/akira`

---

### Phase 4: Production Deployment

**Step 4.1: Restart services**
```bash
pm2 restart akira
pm2 restart api
pm2 restart web
```

**Step 4.2: Monitor first harvest**
```bash
# Watch method learning build up
tail -f /tmp/pulso-akira-out.log | grep "optimized_cascade"

# Check stats
curl http://localhost:5000/admin/method-stats
```

**Step 4.3: Verify Hermes skills**
```bash
hermes cron list
hermes cron run pulso-harvester
hermes cron run pulso-scout
```

---

## Testing Requirements

### Unit Tests (New)

**Google News Extractor:**
```python
def test_google_news_can_extract_false()  # Not URL-based
def test_google_news_single_query()
def test_google_news_limit_respected()
def test_google_news_empty_feed()
def test_google_news_malformed_feed()
def test_google_news_country_parameter()
def test_google_news_spanish_language()
```

**Method Learner:**
```python
def test_method_learner_init_schema()
def test_method_learner_get_best_method_none()
def test_method_learner_get_best_method_found()
def test_method_learner_record_success_new_url()
def test_method_learner_record_success_existing_url()
def test_method_learner_record_failure()
def test_method_learner_consecutive_failures_circuit_open()
def test_method_learner_reset_learning()
def test_method_learner_stats()
```

**Google News Service:**
```python
def test_service_get_location()
def test_service_build_query_ciudad()
def test_service_build_query_provincia()
def test_service_build_query_not_found()
def test_service_get_locations_by_type()
def test_service_province_filter()
```

### Integration Tests

```python
def test_full_extraction_with_learning()
    """Test that second extraction uses learned method."""
    
def test_google_news_batch_concurrency()
    """Test batch extraction respects concurrency limit."""
    
def test_hermes_harvester_compatibility()
    """Verify existing Hermes skill works with AKIRA v3.1."""
    
def test_cascade_optimization_performance()
    """Verify optimized cascade is faster than standard."""
```

---

## Success Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| Tests passing | 38+ | `pytest tests/` |
| Flask extractor removed | ✓ | `ls packages/extractor` (should fail) |
| Disk space saved | 216MB | `du -sh packages/` |
| Method learning functional | ✓ | `/admin/method-stats` returns data |
| Google News single extraction | ✓ | `/extract/google-news` works |
| Google News batch extraction | ✓ | `/extract/google-news/batch` works |
| Hermes compatibility | ✓ | `pulso-harvester` skill works |
| Performance improvement | 80% faster repeat fetch | Compare first vs second extraction |
| No functionality loss | 0 features lost | Checklist verification |

---

## Rollback Plan

If AKIRA v3.1 fails in production:

1. **Stop AKIRA v3.1:**
   ```bash
   pm2 stop akira
   ```

2. **Restore Flask extractor:**
   ```bash
   git checkout packages/extractor/
   pm2 start extractor
   ```

3. **Revert code changes:**
   ```bash
   git revert <commit-hash>
   ```

4. **Verify Flask works:**
   ```bash
   curl -X POST http://localhost:5000/extract \
     -d '{"url": "https://test.com/feed/"}'
   ```

---

## Documentation Updates Required

### Files to Update

1. **AGENTS.md**
   - Replace "Python Extractor" → "AKIRA v3.1"
   - Update endpoints section (add Google News)
   - Update extraction methods table (add method learning)
   - Update database paths (add akira.db, locations.db)

2. **README.md**
   - Update architecture diagram
   - Remove Flask extractor references
   - Add method learning feature

3. **docs/ARQUITECTURA.md**
   - Update pipeline diagram (AKIRA instead of Flask)
   - Add method learning documentation

4. **Hermes Skills**
   - `pulso-harvester/SKILL.md`: Already uses AKIRA ✓
   - `pulso-scout/SKILL.md`: Can now use Google News batch
   - New skill: `pulso-geo-discovery/SKILL.md` (optional)

---

## Future Enhancements (Post-Migration)

### Phase 5: Advanced Features (Optional)

1. **Auto-seed locations:** Sync locations.db from D1 periodically
2. **Method learning API:** Dashboard to view/edit learning data
3. **Google News scheduler:** Cron job for automatic geo-discovery
4. **Smart batch:** Prioritize locations by population/news volume
5. **Export learning data:** Share method stats across instances

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Method learning corrupts data | Low | Medium | SQLite WAL mode + backup |
| Google News rate limit | Medium | Low | 1.5s delay between requests |
| Hermes incompatibility | Low | High | Phase 2 verification + rollback |
| Performance regression | Low | High | Benchmark tests in Phase 1 |
| Locations DB sync drift | Low | Low | Manual seed + validation |

---

## Estimated Effort

| Task | Hours |
|------|-------|
| Implement new components | 8h |
| Write tests | 4h |
| Integration testing | 3h |
| Remove Flask + cleanup | 2h |
| Documentation updates | 2h |
| Deployment + monitoring | 2h |
| **Total** | **21h (~3 days)** |

---

## Dependencies

### Python Packages (Already Installed)
- `feedparser` ✓
- `aiohttp` ✓
- `sqlite3` (stdlib) ✓
- `pydantic` ✓
- `fastapi` ✓
- `uvicorn` ✓

### New Dependencies
- None required (all functionality uses existing packages)

---

## Conclusion

AKIRA v3.1 consolidates all Flask Extractor functionality with zero loss, adds geo-aware Google News extraction, and implements URL-based method learning for significant performance gains. The migration is safe, incremental, and fully tested before Flask removal.

**Next Step:** Invoke `writing-plans` skill to create detailed implementation plan.