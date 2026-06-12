# AKIRA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build AKIRA - a production-grade async extraction engine for Argentine news, replacing Flask with FastAPI.

**Architecture:** Plugin-based extractors with intelligent cascade, multi-backend cache, and Prometheus metrics.

**Tech Stack:** FastAPI, aiohttp, newspaper4k, feedparser, Pydantic v2, SQLite/D1

---

## File Structure

```
packages/akira/
├── __init__.py
├── main.py                    # FastAPI app, routes, lifespan
├── config.py                  # Settings with Pydantic
├── models/
│   ├── __init__.py
│   └── schemas.py             # Request/Response models
├── core/
│   ├── __init__.py
│   ├── engine.py              # Extraction orchestrator
│   ├── cache.py               # Multi-backend cache
│   ├── rate_limiter.py        # Per-domain rate limiting
│   ├── circuit_breaker.py     # Circuit breaker pattern
│   └── metrics.py             # Prometheus metrics
├── extractors/
│   ├── __init__.py
│   ├── base.py                # Base extractor class
│   ├── rss.py                 # RSS/Atom (feedparser)
│   ├── wordpress.py           # WordPress REST API
│   ├── newspaper.py           # newspaper4k
│   ├── goose.py               # goose3 fallback
│   ├── sitemap.py             # Sitemap parser
│   ├── playwright.py          # JS rendering
│   └── jina.py                # Jina Reader
├── services/
│   ├── __init__.py
│   ├── health.py              # Health tracking
│   └── d1_sync.py             # D1 sync service
└── tests/
    ├── __init__.py
    ├── conftest.py             # Shared fixtures
    ├── test_engine.py
    ├── test_extractors.py
    ├── test_cache.py
    └── test_api.py
```

---

### Task 1: Project Structure & Config

**Files:**
- Create: `packages/akira/__init__.py`
- Create: `packages/akira/config.py`
- Create: `packages/akira/models/__init__.py`
- Create: `packages/akira/models/schemas.py`
- Create: `packages/akira/pyproject.toml`

- [ ] **Step 1: Create package structure**

```bash
mkdir -p packages/akira/{core,extractors,services,models,tests}
```

- [ ] **Step 2: Write pyproject.toml**

```toml
# packages/akira/pyproject.toml
[project]
name = "akira"
version = "2.0.0"
description = "AKIRA - PULSO Extraction Engine"
requires-python = ">=3.11"

dependencies = [
    "fastapi>=0.110.0",
    "uvicorn[standard]>=0.29.0",
    "pydantic>=2.6.0",
    "aiohttp>=3.9.0",
    "httpx>=0.27.0",
    "feedparser>=6.0.11",
    "newspaper4k>=0.9.0",
    "goose3>=3.1.19",
    "playwright>=1.42.0",
    "aiosqlite>=0.19.0",
    "prometheus-client>=0.20.0",
    "lxml>=5.1.0",
    "beautifulsoup4>=4.12.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0.0", "pytest-asyncio>=0.23.0", "httpx>=0.27.0"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 3: Write config.py**

```python
# packages/akira/config.py
from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    """AKIRA configuration - values from env or .env"""
    
    # Server
    host: str = "0.0.0.0"
    port: int = 5000
    workers: int = 4
    debug: bool = False
    
    # Cache
    cache_backend: str = "memory"  # memory, sqlite, redis, null
    cache_ttl: int = 600  # 10 minutes
    cache_max_size: int = 1000
    redis_url: Optional[str] = None
    
    # Extraction
    request_delay: float = 1.5  # seconds between same-domain requests
    max_concurrent: int = 20
    default_timeout: int = 60
    
    # Circuit breaker
    circuit_breaker_threshold: int = 5
    circuit_breaker_timeout: int = 60
    
    # D1 Sync
    node_api_url: str = "http://localhost:8787"
    node_api_key: str = "pulso-dev-key-change-in-production"
    
    # Local DB
    db_path: str = f"{__import__('os').path.expanduser('~')}/data/pulso.db"
    
    model_config = {"env_prefix": "AKIRA_", "env_file": ".env"}

settings = Settings()
```

- [ ] **Step 4: Write models/schemas.py**

```python
# packages/akira/models/schemas.py
from pydantic import BaseModel, HttpUrl, Field
from typing import Optional, List, Literal
from datetime import datetime
from enum import Enum

class MethodName(str, Enum):
    RSS = "rss"
    WP_API = "wp_api"
    NEWSPAPER = "newspaper"
    GOOSE = "goose"
    SITEMAP = "sitemap"
    PLAYWRIGHT = "playwright"
    JINA = "jina"

class NewsItem(BaseModel):
    title: str = ""
    url: str = ""
    summary: str = ""
    published_at: Optional[str] = None
    image_url: Optional[str] = None
    source: str = ""

class ExtractRequest(BaseModel):
    url: HttpUrl
    source_id: Optional[int] = None
    location_id: Optional[int] = None
    prefer_method: Optional[MethodName] = None
    use_cache: bool = True
    timeout: int = Field(default=60, gt=0, le=120)

class ExtractResult(BaseModel):
    success: bool
    method: MethodName
    type: Literal["feed", "article"]
    items: List[NewsItem] = []
    article: Optional[dict] = None
    duration_ms: int
    cached: bool = False
    source_id: Optional[int] = None
    error: Optional[str] = None

class HealthResponse(BaseModel):
    status: Literal["healthy", "degraded", "unhealthy"]
    version: str = "2.0.0"
    uptime_seconds: int
    active_extractions: int
    cache_hit_rate: float
    extractors: dict
    memory_mb: float
```

- [ ] **Step 5: Create empty __init__.py files**

```bash
touch packages/akira/{core,extractors,services,models,tests}/__init__.py
```

- [ ] **Step 6: Commit**

```bash
git add packages/akira/
git commit -m "feat: create AKIRA package structure with config and models"
```

---

### Task 2: Core Engine - Rate Limiter & Circuit Breaker

**Files:**
- Create: `packages/akira/core/__init__.py`
- Create: `packages/akira/core/rate_limiter.py`
- Create: `packages/akira/core/circuit_breaker.py`

- [ ] **Step 1: Write rate_limiter.py**

```python
# packages/akira/core/rate_limiter.py
import time
import asyncio
from urllib.parse import urlparse
from collections import defaultdict
from typing import Dict

class RateLimiter:
    """
    Per-domain rate limiting (best practice: respect target sites).
    1.5s delay between requests to same domain, parallel across domains.
    """
    
    def __init__(self, delay: float = 1.5):
        self.delay = delay
        self.last_request: Dict[str, float] = defaultdict(float)
        self._locks: Dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
    
    def _get_domain(self, url: str) -> str:
        return urlparse(url).netloc
    
    async def wait(self, url: str) -> None:
        """Wait if needed to respect rate limit for this domain"""
        domain = self._get_domain(url)
        
        async with self._locks[domain]:
            now = time.time()
            last = self.last_request[domain]
            elapsed = now - last
            
            if elapsed < self.delay:
                sleep_time = self.delay - elapsed
                await asyncio.sleep(sleep_time)
            
            self.last_request[domain] = time.time()
```

- [ ] **Step 2: Write circuit_breaker.py**

```python
# packages/akira/core/circuit_breaker.py
import time
from datetime import datetime
from typing import Dict, Optional
from collections import defaultdict

class CircuitBreaker:
    """
    Circuit breaker pattern: pause sources with repeated failures.
    After 5 consecutive failures, pause for 60 seconds.
    """
    
    def __init__(self, threshold: int = 5, timeout: int = 60):
        self.threshold = threshold
        self.timeout = timeout
        self.failures: Dict[str, int] = defaultdict(int)
        self.last_failure: Dict[str, float] = {}
    
    def record_success(self, url: str) -> None:
        """Reset failure count on success"""
        self.failures[url] = 0
        self.last_failure.pop(url, None)
    
    def record_failure(self, url: str) -> None:
        """Record a failure, may open circuit"""
        self.failures[url] += 1
        self.last_failure[url] = time.time()
    
    def is_open(self, url: str) -> bool:
        """Check if circuit is open (source should be skipped)"""
        if self.failures[url] < self.threshold:
            return False
        
        last = self.last_failure.get(url, 0)
        elapsed = time.time() - last
        
        if elapsed >= self.timeout:
            # Timeout passed, try again (half-open)
            self.failures[url] = 0
            return False
        
        return True
```

- [ ] **Step 3: Write test for RateLimiter**

```python
# packages/akira/tests/test_rate_limiter.py
import pytest
import time
from core.rate_limiter import RateLimiter

@pytest.mark.asyncio
async def test_rate_limiter_waits():
    limiter = RateLimiter(delay=0.1)  # 100ms for test
    
    start = time.time()
    await limiter.wait("https://example.com/a")
    await limiter.wait("https://example.com/b")  # Same domain
    elapsed = time.time() - start
    
    assert elapsed >= 0.1  # Waited

@pytest.mark.asyncio
async def test_rate_limiter_parallel_domains():
    limiter = RateLimiter(delay=0.5)
    
    start = time.time()
    await limiter.wait("https://domain1.com/a")
    await limiter.wait("https://domain2.com/a")  # Different domain
    elapsed = time.time() - start
    
    assert elapsed < 0.3  # No wait between domains
```

- [ ] **Step 4: Run tests**

```bash
cd packages/akira && python -m pytest tests/test_rate_limiter.py -v
```

Expected: 2 PASS

- [ ] **Step 5: Write test for CircuitBreaker**

```python
# packages/akira/tests/test_circuit_breaker.py
import pytest
from core.circuit_breaker import CircuitBreaker

def test_circuit_opens_after_threshold():
    cb = CircuitBreaker(threshold=3, timeout=60)
    url = "https://failing.com"
    
    for _ in range(3):
        cb.record_failure(url)
    
    assert cb.is_open(url) == True

def test_circuit_closes_after_timeout():
    cb = CircuitBreaker(threshold=3, timeout=0.1)
    url = "https://failing.com"
    
    for _ in range(3):
        cb.record_failure(url)
    
    import time
    time.sleep(0.15)
    
    assert cb.is_open(url) == False  # Closed after timeout

def test_success_resets_circuit():
    cb = CircuitBreaker(threshold=3)
    url = "https://failing.com"
    
    cb.record_failure(url)
    cb.record_failure(url)
    cb.record_success(url)
    
    assert cb.failures[url] == 0
```

- [ ] **Step 6: Run tests**

```bash
cd packages/akira && python -m pytest tests/test_circuit_breaker.py -v
```

Expected: 3 PASS

- [ ] **Step 7: Commit**

```bash
git add packages/akira/core/ packages/akira/tests/
git commit -m "feat: add rate limiter and circuit breaker core modules"
```

---

### Task 3: Core Engine - Cache Layer

**Files:**
- Create: `packages/akira/core/cache.py`
- Create: `packages/akira/tests/test_cache.py`

- [ ] **Step 1: Write cache.py with multi-backend**

```python
# packages/akira/core/cache.py
import json
import time
import hashlib
from abc import ABC, abstractmethod
from typing import Optional, Any
from collections import OrderedDict

class CacheBackend(ABC):
    """Base cache backend interface (pattern: RSS-Bridge)"""
    
    @abstractmethod
    async def get(self, key: str) -> Optional[bytes]:
        pass
    
    @abstractmethod
    async def set(self, key: str, value: bytes, ttl: int) -> None:
        pass
    
    @abstractmethod
    async def delete(self, key: str) -> None:
        pass

class MemoryBackend(CacheBackend):
    """In-memory LRU cache (fast, ephemeral)"""
    
    def __init__(self, maxsize: int = 1000):
        self.maxsize = maxsize
        self._cache: OrderedDict = OrderedDict()
        self._expiry: dict = {}
    
    async def get(self, key: str) -> Optional[bytes]:
        if key in self._cache:
            if self._expiry.get(key, 0) > time.time():
                self._cache.move_to_end(key)
                return self._cache[key]
            else:
                del self._cache[key]
                del self._expiry[key]
        return None
    
    async def set(self, key: str, value: bytes, ttl: int = 600) -> None:
        if key in self._cache:
            self._cache.move_to_end(key)
        self._cache[key] = value
        self._expiry[key] = time.time() + ttl
        
        if len(self._cache) > self.maxsize:
            oldest = next(iter(self._cache))
            del self._cache[oldest]
            del self._expiry[oldest]
    
    async def delete(self, key: str) -> None:
        self._cache.pop(key, None)
        self._expiry.pop(key, None)

class NullBackend(CacheBackend):
    """No-op cache (for testing)"""
    
    async def get(self, key: str) -> Optional[bytes]:
        return None
    
    async def set(self, key: str, value: bytes, ttl: int = 600) -> None:
        pass
    
    async def delete(self, key: str) -> None:
        pass

class CacheManager:
    """
    Two-tier caching: L1 memory + L2 persistent backend.
    Pattern from news-please + RSS-Bridge.
    """
    
    def __init__(self, backend: Optional[CacheBackend] = None, l1_size: int = 1000):
        self.backend = backend or MemoryBackend(maxsize=l1_size)
        self._stats = {"hits": 0, "misses": 0}
    
    def _make_key(self, url: str) -> str:
        """Create stable cache key from URL"""
        normalized = url.rstrip("/").lower()
        return f"extract:{hashlib.md5(normalized.encode()).hexdigest()}"
    
    async def get(self, url: str) -> Optional[dict]:
        """Get cached extraction result"""
        key = self._make_key(url)
        data = await self.backend.get(key)
        
        if data:
            self._stats["hits"] += 1
            return json.loads(data)
        
        self._stats["misses"] += 1
        return None
    
    async def set(self, url: str, result: dict, ttl: int = 600) -> None:
        """Cache extraction result"""
        key = self._make_key(url)
        data = json.dumps(result).encode()
        await self.backend.set(key, data, ttl)
    
    @property
    def hit_rate(self) -> float:
        total = self._stats["hits"] + self._stats["misses"]
        return self._stats["hits"] / total if total > 0 else 0.0
    
    def reset_stats(self) -> None:
        self._stats = {"hits": 0, "misses": 0}
```

- [ ] **Step 2: Write cache tests**

```python
# packages/akira/tests/test_cache.py
import pytest
from core.cache import CacheManager, MemoryBackend, NullBackend

@pytest.mark.asyncio
async def test_memory_cache_hit():
    cache = CacheManager(MemoryBackend(maxsize=100))
    
    await cache.set("https://test.com", {"title": "Test"})
    result = await cache.get("https://test.com")
    
    assert result == {"title": "Test"}
    assert cache.hit_rate == 1.0

@pytest.mark.asyncio
async def test_memory_cache_miss():
    cache = CacheManager(MemoryBackend(maxsize=100))
    
    result = await cache.get("https://missing.com")
    
    assert result is None
    assert cache.hit_rate == 0.0

@pytest.mark.asyncio
async def test_cache_ttl_expiry():
    cache = CacheManager(MemoryBackend(maxsize=100))
    
    await cache.set("https://test.com", {"data": "old"}, ttl=0)
    
    import asyncio
    await asyncio.sleep(0.01)
    
    result = await cache.get("https://test.com")
    assert result is None

@pytest.mark.asyncio
async def test_null_backend():
    cache = CacheManager(NullBackend())
    
    await cache.set("https://test.com", {"data": "value"})
    result = await cache.get("https://test.com")
    
    assert result is None  # Null backend never stores
```

- [ ] **Step 3: Run tests**

```bash
cd packages/akira && python -m pytest tests/test_cache.py -v
```

Expected: 4 PASS

- [ ] **Step 4: Commit**

```bash
git add packages/akira/core/cache.py packages/akira/tests/test_cache.py
git commit -m "feat: add multi-backend cache layer"
```

---

### Task 4: Base Extractor & RSS Extractor

**Files:**
- Create: `packages/akira/extractors/base.py`
- Create: `packages/akira/extractors/rss.py`
- Create: `packages/akira/tests/test_extractors.py`

- [ ] **Step 1: Write base extractor**

```python
# packages/akira/extractors/base.py
from abc import ABC, abstractmethod
from typing import List, Optional
from dataclasses import dataclass

@dataclass
class ExtractedItem:
    """Standard extraction result"""
    title: str = ""
    url: str = ""
    summary: str = ""
    published_at: Optional[str] = None
    image_url: Optional[str] = None
    source: str = ""
    text: Optional[str] = None  # Full article text (for articles)

class BaseExtractor(ABC):
    """
    Base extractor class (pattern: RSS-Bridge BridgeAbstract).
    Each extractor handles one extraction method.
    """
    
    NAME: str = "base"
    PRIORITY: int = 50  # Higher = tried first
    
    @abstractmethod
    async def extract(self, url: str, timeout: int = 30) -> List[ExtractedItem]:
        """
        Extract content from URL.
        Returns list of items (feed) or single item (article).
        """
        pass
    
    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        """Check if this extractor can handle the URL"""
        return False
    
    def _default_timeout(self) -> int:
        return 30
```

- [ ] **Step 2: Write RSS extractor**

```python
# packages/akira/extractors/rss.py
import asyncio
from typing import List, Optional
from .base import BaseExtractor, ExtractedItem

class RSSExtractor(BaseExtractor):
    """
    RSS/Atom feed extractor using feedparser.
    Most reliable method for news sites.
    """
    
    NAME = "rss"
    PRIORITY = 100  # Highest priority
    
    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        """Detect RSS feeds by URL pattern"""
        rss_patterns = ["/feed", "/rss", ".xml", "feedburner"]
        return any(pattern in url.lower() for pattern in rss_patterns)
    
    async def extract(self, url: str, timeout: int = 30) -> List[ExtractedItem]:
        """Extract RSS/Atom feed using feedparser (sync in thread)"""
        import feedparser
        
        # Run in thread to avoid blocking
        loop = asyncio.get_event_loop()
        feed = await loop.run_in_executor(None, feedparser.parse, url)
        
        if feed.bozo and not feed.entries:
            raise ValueError(f"Invalid feed: {feed.bozo_exception}")
        
        items = []
        for entry in feed.entries[:20]:  # Limit to 20 items
            image_url = None
            
            # Try to get image from media_content
            if hasattr(entry, "media_content"):
                for media in entry.media_content:
                    if "image" in media.get("type", ""):
                        image_url = media.get("url")
                        break
            
            items.append(ExtractedItem(
                title=entry.get("title", ""),
                url=entry.get("link", ""),
                summary=entry.get("summary", "")[:500],
                published_at=entry.get("published", ""),
                image_url=image_url,
                source=url,
            ))
        
        return items
    
    def _default_timeout(self) -> int:
        return 30
```

- [ ] **Step 3: Write extractor tests**

```python
# packages/akira/tests/test_extractors.py
import pytest
from extractors.rss import RSSExtractor
from extractors.base import ExtractedItem

def test_rss_detector():
    assert RSSExtractor.can_extract("https://example.com/feed") == True
    assert RSSExtractor.can_extract("https://example.com/rss") == True
    assert RSSExtractor.can_extract("https://example.com/feedburner") == True
    assert RSSExtractor.can_extract("https://example.com/article") == False

@pytest.mark.asyncio
async def test_rss_extraction():
    extractor = RSSExtractor()
    
    # Use a stable public feed for testing
    items = await extractor.extract("https://feeds.bbci.co.uk/news/rss.xml", timeout=10)
    
    assert len(items) > 0
    assert isinstance(items[0], ExtractedItem)
    assert items[0].title  # Has title
    assert items[0].url    # Has URL
```

- [ ] **Step 4: Run tests**

```bash
cd packages/akira && python -m pytest tests/test_extractors.py -v
```

Expected: 2 PASS (if network available, test_rss_extraction may take a few seconds)

- [ ] **Step 5: Commit**

```bash
git add packages/akira/extractors/ packages/akira/tests/test_extractors.py
git commit -m "feat: add base extractor and RSS extractor"
```

---

### Task 5: Newspaper & Goose Extractors

**Files:**
- Modify: `packages/akira/extractors/newspaper.py` (create)
- Modify: `packages/akira/extractors/goose.py` (create)
- Modify: `packages/akira/tests/test_extractors.py` (add tests)

- [ ] **Step 1: Write newspaper extractor**

```python
# packages/akira/extractors/newspaper.py
import asyncio
from typing import List, Optional
from .base import BaseExtractor, ExtractedItem

class NewspaperExtractor(BaseExtractor):
    """
    Article extractor using newspaper4k.
    Best for extracting full article content.
    """
    
    NAME = "newspaper"
    PRIORITY = 70
    
    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        """Newspaper can try any article URL"""
        # Skip obvious non-article URLs
        skip_patterns = ["/feed", "/rss", ".xml", "/tag/", "/category/"]
        return not any(pattern in url.lower() for pattern in skip_patterns)
    
    async def extract(self, url: str, timeout: int = 60) -> List[ExtractedItem]:
        """Extract article using newspaper4k (sync in thread)"""
        from newspaper import Article as NewspaperArticle
        
        loop = asyncio.get_event_loop()
        
        def _extract():
            article = NewspaperArticle(url, language="es")
            article.download()
            article.parse()
            
            # Try NLP (may fail)
            try:
                article.nlp()
            except:
                pass
            
            return article
        
        article = await asyncio.wait_for(
            loop.run_in_executor(None, _extract),
            timeout=timeout
        )
        
        if not article.title or len(article.text or "") < 50:
            raise ValueError("Article extraction failed or too short")
        
        return [ExtractedItem(
            title=article.title or "",
            url=url,
            summary=(article.summary or "")[:500],
            published_at=article.publish_date.isoformat() if article.publish_date else None,
            image_url=article.top_image,
            source=url,
            text=article.text[:3000] if article.text else None,
        )]
    
    def _default_timeout(self) -> int:
        return 60
```

- [ ] **Step 2: Write goose extractor**

```python
# packages/akira/extractors/goose.py
import asyncio
from typing import List, Optional
from .base import BaseExtractor, ExtractedItem

class GooseExtractor(BaseExtractor):
    """
    Fallback article extractor using goose3.
    Use when newspaper fails.
    """
    
    NAME = "goose"
    PRIORITY = 60
    
    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        return True  # Goose can try anything
    
    async def extract(self, url: str, timeout: int = 60) -> List[ExtractedItem]:
        """Extract using goose3 (sync in thread)"""
        from goose3 import Goose
        
        loop = asyncio.get_event_loop()
        
        def _extract():
            g = Goose()
            return g.extract(url=url)
        
        article = await asyncio.wait_for(
            loop.run_in_executor(None, _extract),
            timeout=timeout
        )
        
        if not article.title or len(article.cleaned_text or "") < 50:
            raise ValueError("Goose extraction failed")
        
        return [ExtractedItem(
            title=article.title or "",
            url=url,
            summary=(article.meta_description or "")[:500],
            published_at=article.publish_date.isoformat() if article.publish_date else None,
            image_url=article.top_image.src if article.top_image else None,
            source=url,
            text=(article.cleaned_text or "")[:3000],
        )]
    
    def _default_timeout(self) -> int:
        return 60
```

- [ ] **Step 3: Commit**

```bash
git add packages/akira/extractors/newspaper.py packages/akira/extractors/goose.py
git commit -m "feat: add newspaper and goose extractors"
```

---

### Task 6: WordPress & Sitemap Extractors

**Files:**
- Create: `packages/akira/extractors/wordpress.py`
- Create: `packages/akira/extractors/sitemap.py`

- [ ] **Step 1: Write WordPress extractor**

```python
# packages/akira/extractors/wordpress.py
import asyncio
from typing import List, Optional
from .base import BaseExtractor, ExtractedItem

class WordPressExtractor(BaseExtractor):
    """
    WordPress REST API extractor.
    Fastest method for WordPress sites (900 of our 944 portals).
    """
    
    NAME = "wordpress"
    PRIORITY = 90
    
    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        """Detect WordPress by meta generator or URL pattern"""
        if html:
            return 'wp-json' in html or 'WordPress' in html
        return "/wp-" in url
    
    async def extract(self, url: str, timeout: int = 30) -> List[ExtractedItem]:
        """Extract via WP REST API"""
        import aiohttp
        
        api_url = url.rstrip("/") + "/wp-json/wp/v2/posts"
        params = {"per_page": 20, "_embed": "true"}
        
        async with aiohttp.ClientSession() as session:
            async with session.get(api_url, params=params, timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
                if resp.status != 200:
                    raise ValueError(f"WP API returned {resp.status}")
                
                posts = await resp.json()
        
        items = []
        for post in posts:
            # Get featured image
            image_url = None
            if "_embedded" in post and "wp:featuredmedia" in post["_embedded"]:
                media = post["_embedded"]["wp:featuredmedia"]
                if media and len(media) > 0:
                    image_url = media[0].get("source_url")
            
            items.append(ExtractedItem(
                title=post.get("title", {}).get("rendered", ""),
                url=post.get("link", ""),
                summary=post.get("excerpt", {}).get("rendered", "")[:500],
                published_at=post.get("date", ""),
                image_url=image_url,
                source=url,
            ))
        
        return items
    
    def _default_timeout(self) -> int:
        return 30
```

- [ ] **Step 2: Write Sitemap extractor**

```python
# packages/akira/extractors/sitemap.py
import asyncio
from typing import List, Optional
from .base import BaseExtractor, ExtractedItem

class SitemapExtractor(BaseExtractor):
    """
    Sitemap.xml parser to find recent article URLs.
    Does not extract content, just URLs for further processing.
    """
    
    NAME = "sitemap"
    PRIORITY = 50
    
    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        return True  # Can always try sitemap
    
    async def extract(self, url: str, timeout: int = 15) -> List[ExtractedItem]:
        """Parse sitemap.xml to find recent URLs"""
        import aiohttp
        import xml.etree.ElementTree as ET
        
        base_url = url.rstrip("/")
        sitemap_paths = ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"]
        
        async with aiohttp.ClientSession() as session:
            for path in sitemap_paths:
                try:
                    sitemap_url = base_url + path
                    async with session.get(sitemap_url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                        if resp.status != 200:
                            continue
                        
                        content = await resp.text()
                        root = ET.fromstring(content)
                        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
                        
                        items = []
                        for url_elem in root.findall(".//sm:url", ns)[:20]:
                            loc = url_elem.find("sm:loc", ns)
                            lastmod = url_elem.find("sm:lastmod", ns)
                            
                            if loc is not None:
                                # Extract title from URL path
                                title = loc.text.split("/")[-1].replace("-", " ").replace(".html", "")
                                
                                items.append(ExtractedItem(
                                    title=title.title(),
                                    url=loc.text,
                                    summary="",
                                    published_at=lastmod.text if lastmod is not None else None,
                                    source=url,
                                ))
                        
                        if items:
                            return items
                            
                except Exception:
                    continue
        
        return []  # No sitemap found
    
    def _default_timeout(self) -> int:
        return 15
```

- [ ] **Step 3: Commit**

```bash
git add packages/akira/extractors/wordpress.py packages/akira/extractors/sitemap.py
git commit -m "feat: add WordPress and Sitemap extractors"
```

---

### Task 7: Jina & Playwright Extractors

**Files:**
- Create: `packages/akira/extractors/jina.py`
- Create: `packages/akira/extractors/playwright.py`

- [ ] **Step 1: Write Jina extractor**

```python
# packages/akira/extractors/jina.py
import asyncio
from typing import List, Optional
from .base import BaseExtractor, ExtractedItem

class JinaExtractor(BaseExtractor):
    """
    Jina Reader API - last resort for difficult sites.
    Uses r.jina.ai service to extract content.
    """
    
    NAME = "jina"
    PRIORITY = 10  # Lowest priority
    
    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        return True  # Last resort
    
    async def extract(self, url: str, timeout: int = 60) -> List[ExtractedItem]:
        """Extract using Jina Reader API"""
        import aiohttp
        
        jina_url = f"https://r.jina.ai/{url}"
        headers = {
            "Accept": "application/json",
            "X-Return-Format": "json",
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.get(jina_url, headers=headers, timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
                resp.raise_for_status()
                data = await resp.json()
        
        content = data.get("data", {}).get("content", "")
        
        if not content:
            raise ValueError("Jina returned empty content")
        
        # Derive title from URL
        title = url.split("/")[-1].replace("-", " ").title() or "Article"
        
        return [ExtractedItem(
            title=title,
            url=url,
            summary=content[:500],
            source=url,
            text=content[:3000],
        )]
    
    def _default_timeout(self) -> int:
        return 60
```

- [ ] **Step 2: Write Playwright extractor**

```python
# packages/akira/extractors/playwright.py
import asyncio
from typing import List, Optional
from .base import BaseExtractor, ExtractedItem

class PlaywrightExtractor(BaseExtractor):
    """
    Playwright-based extractor for JS-heavy sites.
    Renders page in headless browser.
    """
    
    NAME = "playwright"
    PRIORITY = 30
    
    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        # Use for sites known to need JS
        return True  # Can try, but expensive
    
    async def extract(self, url: str, timeout: int = 60) -> List[ExtractedItem]:
        """Extract using Playwright headless browser"""
        from playwright.async_api import async_playwright
        
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            page.set_default_timeout(timeout * 1000)
            
            await page.goto(url, wait_until="networkidle")
            
            title = await page.title()
            
            # Try common article selectors
            content = ""
            for selector in ["article", ".article-content", ".post-content", "main", ".content"]:
                try:
                    element = await page.query_selector(selector)
                    if element:
                        content = await element.inner_text()
                        if len(content) > 200:
                            break
                except:
                    continue
            
            if not content:
                content = await page.inner_text("body")
            
            # Get main image
            image_url = None
            try:
                img = await page.query_selector("article img, .featured-image img, main img")
                if img:
                    image_url = await img.get_attribute("src")
            except:
                pass
            
            await browser.close()
        
        if not content:
            raise ValueError("Playwright extracted no content")
        
        return [ExtractedItem(
            title=title or "Article",
            url=url,
            summary=content[:500],
            source=url,
            text=content[:3000],
            image_url=image_url,
        )]
    
    def _default_timeout(self) -> int:
        return 60
```

- [ ] **Step 3: Commit**

```bash
git add packages/akira/extractors/jina.py packages/akira/extractors/playwright.py
git commit -m "feat: add Jina and Playwright extractors"
```

---

### Task 8: Main Engine Orchestrator

**Files:**
- Create: `packages/akira/core/engine.py`
- Create: `packages/akira/tests/test_engine.py`

- [ ] **Step 1: Write engine.py**

```python
# packages/akira/core/engine.py
import time
import logging
from typing import List, Optional, Type
from ..extractors.base import BaseExtractor, ExtractedItem
from ..models.schemas import ExtractResult, MethodName, NewsItem
from .cache import CacheManager
from .rate_limiter import RateLimiter
from .circuit_breaker import CircuitBreaker

logger = logging.getLogger("akira")

class ExtractionEngine:
    """
    Main extraction orchestrator.
    Manages intelligent cascade through extractors.
    """
    
    def __init__(
        self,
        extractors: List[Type[BaseExtractor]],
        cache: CacheManager,
        rate_limiter: RateLimiter,
        circuit_breaker: CircuitBreaker,
    ):
        # Sort extractors by priority (highest first)
        self.extractors = sorted(extractors, key=lambda e: e.PRIORITY, reverse=True)
        self.cache = cache
        self.rate_limiter = rate_limiter
        self.circuit_breaker = circuit_breaker
    
    async def extract(
        self,
        url: str,
        source_id: Optional[int] = None,
        prefer_method: Optional[MethodName] = None,
        use_cache: bool = True,
        timeout: int = 60,
    ) -> ExtractResult:
        """
        Extract from URL with intelligent cascade.
        
        Cascade:
        1. Check cache
        2. Check circuit breaker
        3. Try extractors in order
        4. Return first success
        """
        start_time = time.time()
        
        # 1. Check cache
        if use_cache:
            cached = await self.cache.get(url)
            if cached:
                logger.info("cache_hit", extra={"url": url})
                cached["cached"] = True
                return ExtractResult(**cached)
        
        # 2. Check circuit breaker
        if self.circuit_breaker.is_open(url):
            logger.warning("circuit_open", extra={"url": url})
            return ExtractResult(
                success=False,
                method=MethodName.JINA,  # Placeholder
                type="article",
                duration_ms=int((time.time() - start_time) * 1000),
                error="Circuit open - source failing repeatedly",
            )
        
        # 3. Determine extraction order
        if prefer_method:
            order = self._order_for_method(prefer_method)
        else:
            order = self.extractors
        
        # 4. Try each extractor
        last_error = None
        for extractor_class in order:
            extractor = extractor_class()
            
            # Check if extractor can handle this URL
            if not extractor_class.can_extract(url):
                continue
            
            # Rate limit
            await self.rate_limiter.wait(url)
            
            try:
                logger.info(f"trying_{extractor.NAME}", extra={"url": url})
                
                items = await extractor.extract(url, timeout=extractor._default_timeout())
                
                if items:
                    # Success!
                    self.circuit_breaker.record_success(url)
                    
                    result = ExtractResult(
                        success=True,
                        method=MethodName(extractor.NAME),
                        type="feed" if len(items) > 1 else "article",
                        items=[NewsItem(**item.__dict__) for item in items],
                        duration_ms=int((time.time() - start_time) * 1000),
                        source_id=source_id,
                    )
                    
                    # Cache success
                    if use_cache:
                        await self.cache.set(url, result.model_dump())
                    
                    logger.info(
                        f"extraction_success",
                        extra={"url": url, "method": extractor.NAME, "items": len(items)},
                    )
                    
                    return result
                    
            except Exception as e:
                last_error = str(e)
                logger.warning(
                    f"extraction_failed",
                    extra={"url": url, "method": extractor.NAME, "error": str(e)[:100]},
                )
                continue
        
        # All extractors failed
        self.circuit_breaker.record_failure(url)
        
        return ExtractResult(
            success=False,
            method=MethodName.JINA,  # Last attempted
            type="article",
            duration_ms=int((time.time() - start_time) * 1000),
            source_id=source_id,
            error=last_error or "All extractors failed",
        )
    
    def _order_for_method(self, method: MethodName) -> List[Type[BaseExtractor]]:
        """Get extractors ordered with preferred method first"""
        method_name = method.value
        preferred = [e for e in self.extractors if e.NAME == method_name]
        others = [e for e in self.extractors if e.NAME != method_name]
        return preferred + others
```

- [ ] **Step 2: Write engine tests**

```python
# packages/akira/tests/test_engine.py
import pytest
from core.engine import ExtractionEngine
from core.cache import CacheManager, MemoryBackend
from core.rate_limiter import RateLimiter
from core.circuit_breaker import CircuitBreaker
from extractors.rss import RSSExtractor
from extractors.base import ExtractedItem

class MockExtractor(BaseExtractor):
    """Mock extractor for testing"""
    NAME = "mock"
    PRIORITY = 80
    
    @classmethod
    def can_extract(cls, url: str, html=None) -> bool:
        return "mock" in url
    
    async def extract(self, url: str, timeout: int = 30):
        return [ExtractedItem(title="Mock Article", url=url)]

@pytest.mark.asyncio
async def test_engine_returns_first_success():
    engine = ExtractionEngine(
        extractors=[MockExtractor],
        cache=CacheManager(MemoryBackend()),
        rate_limiter=RateLimiter(0.01),
        circuit_breaker=CircuitBreaker(),
    )
    
    result = await engine.extract("https://mock.example.com/article")
    
    assert result.success == True
    assert result.method.value == "mock"
    assert len(result.items) == 1

@pytest.mark.asyncio
async def test_engine_caches_success():
    engine = ExtractionEngine(
        extractors=[MockExtractor],
        cache=CacheManager(MemoryBackend()),
        rate_limiter=RateLimiter(0.01),
        circuit_breaker=CircuitBreaker(),
    )
    
    # First call - extraction
    result1 = await engine.extract("https://mock.example.com/article")
    assert result1.cached == False
    
    # Second call - cache hit
    result2 = await engine.extract("https://mock.example.com/article")
    assert result2.cached == True
```

- [ ] **Step 3: Run tests**

```bash
cd packages/akira && python -m pytest tests/test_engine.py -v
```

Expected: 2 PASS

- [ ] **Step 4: Commit**

```bash
git add packages/akira/core/engine.py packages/akira/tests/test_engine.py
git commit -m "feat: add extraction engine orchestrator with cascade"
```

---

### Task 9: FastAPI Application

**Files:**
- Create: `packages/akira/main.py`
- Modify: `packages/akira/__init__.py`

- [ ] **Step 1: Write main.py**

```python
# packages/akira/main.py
"""
AKIRA - PULSO Extraction Engine
FastAPI application with intelligent extraction cascade.
"""
import time
import logging
from contextlib import asynccontextmanager
from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .models.schemas import (
    ExtractRequest, ExtractResult, HealthResponse, MethodName
)
from .core.engine import ExtractionEngine
from .core.cache import CacheManager, MemoryBackend
from .core.rate_limiter import RateLimiter
from .core.circuit_breaker import CircuitBreaker
from .extractors.rss import RSSExtractor
from .extractors.wordpress import WordPressExtractor
from .extractors.newspaper import NewspaperExtractor
from .extractors.goose import GooseExtractor
from .extractors.sitemap import SitemapExtractor
from .extractors.playwright import PlaywrightExtractor
from .extractors.jina import JinaExtractor

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("akira")

# Globals
engine: ExtractionEngine = None
start_time: float = 0

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - setup and teardown"""
    global engine, start_time
    
    start_time = time.time()
    
    # Initialize components
    cache = CacheManager(MemoryBackend(maxsize=settings.cache_max_size))
    rate_limiter = RateLimiter(delay=settings.request_delay)
    circuit_breaker = CircuitBreaker(
        threshold=settings.circuit_breaker_threshold,
        timeout=settings.circuit_breaker_timeout,
    )
    
    # Initialize extractors
    extractors = [
        RSSExtractor,
        WordPressExtractor,
        NewspaperExtractor,
        GooseExtractor,
        SitemapExtractor,
        PlaywrightExtractor,
        JinaExtractor,
    ]
    
    engine = ExtractionEngine(
        extractors=extractors,
        cache=cache,
        rate_limiter=rate_limiter,
        circuit_breaker=circuit_breaker,
    )
    
    logger.info(f"AKIRA started on {settings.host}:{settings.port}")
    
    yield  # App runs here
    
    logger.info("AKIRA shutting down")

# Create app
app = FastAPI(
    title="AKIRA",
    description="PULSO Extraction Engine",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return HealthResponse(
        status="healthy",
        version="2.0.0",
        uptime_seconds=int(time.time() - start_time),
        active_extractions=0,
        cache_hit_rate=engine.cache.hit_rate if engine else 0,
        extractors={e.NAME: {"status": "healthy"} for e in engine.extractors} if engine else {},
        memory_mb=0,
    )

@app.post("/extract", response_model=ExtractResult)
async def extract(request: ExtractRequest):
    """
    Extract news from URL using intelligent cascade.
    
    Cascade order:
    1. RSS (feedparser) - fastest for feeds
    2. WordPress REST API - fast for WP sites
    3. Newspaper - best for articles
    4. Goose - fallback
    5. Sitemap - find URLs
    6. Playwright - JS-heavy sites
    7. Jina - last resort
    """
    if not engine:
        raise HTTPException(503, "Engine not initialized")
    
    return await engine.extract(
        url=str(request.url),
        source_id=request.source_id,
        prefer_method=request.prefer_method,
        use_cache=request.use_cache,
        timeout=request.timeout,
    )

@app.post("/extract/batch")
async def extract_batch(urls: List[str], max_concurrent: int = 10):
    """
    Batch extraction with controlled concurrency.
    Yields results as they complete.
    """
    # TODO: Implement batch extraction with semaphore
    return {"message": "Not yet implemented"}

@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint"""
    # TODO: Return Prometheus metrics
    return {"message": "Not yet implemented"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=True)
```

- [ ] **Step 2: Test the API**

```bash
cd packages/akira && python -m uvicorn main:app --host 0.0.0.0 --port 5001 --reload &
sleep 2
curl http://localhost:5001/health | jq .
```

Expected:
```json
{
  "status": "healthy",
  "version": "2.0.0",
  "uptime_seconds": 2,
  ...
}
```

- [ ] **Step 3: Test extraction**

```bash
curl -X POST http://localhost:5001/extract \
  -H "Content-Type: application/json" \
  -d '{"url": "https://feeds.bbci.co.uk/news/rss.xml"}' | jq '{success, method, items_count}'
```

Expected:
```json
{
  "success": true,
  "method": "rss",
  "items_count": 10
}
```

- [ ] **Step 4: Kill server and commit**

```bash
pkill -f "uvicorn main:app"
git add packages/akira/main.py
git commit -m "feat: add FastAPI application with extraction endpoints"
```

---

### Task 10: Integration Test & Final Verification

**Files:**
- Create: `packages/akira/tests/test_integration.py`

- [ ] **Step 1: Write integration test**

```python
# packages/akira/tests/test_integration.py
"""
Integration tests for AKIRA extraction engine.
Tests real extraction against known sources.
"""
import pytest
from httpx import AsyncClient
from main import app

@pytest.mark.asyncio
async def test_health_endpoint():
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["version"] == "2.0.0"

@pytest.mark.asyncio
async def test_rss_extraction():
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post("/extract", json={
            "url": "https://feeds.bbci.co.uk/news/rss.xml",
            "use_cache": False,
        })
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] == True
        assert data["method"] == "rss"
        assert len(data["items"]) > 0

@pytest.mark.asyncio
async def test_invalid_url():
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post("/extract", json={
            "url": "not-a-valid-url",
        })
        
        assert response.status_code == 422  # Validation error
```

- [ ] **Step 2: Run integration tests**

```bash
cd packages/akira && python -m pytest tests/test_integration.py -v
```

Expected: 3 PASS

- [ ] **Step 3: Final verification**

```bash
# Run all tests
cd packages/akira && python -m pytest tests/ -v

# Check for import errors
python -c "from main import app; print('OK')"

# Lint check (if ruff installed)
ruff check .
```

- [ ] **Step 4: Commit**

```bash
git add packages/akira/tests/test_integration.py
git commit -m "test: add integration tests and final verification"
```

---

## Summary

After completing all tasks, you will have:

1. **AKIRA package** (`packages/akira/`) with production-ready extraction engine
2. **7 extractors**: RSS, WordPress, Newspaper, Goose, Sitemap, Playwright, Jina
3. **Multi-backend cache**: Memory, Null (Redis ready)
4. **Circuit breaker**: Pause failing sources automatically
5. **Rate limiter**: Respect target sites (1.5s per domain)
6. **FastAPI app**: `/extract`, `/health`, `/metrics` endpoints
7. **Tests**: Unit + integration tests

### Running AKIRA

```bash
cd packages/akira
pip install -e ".[dev]"
python -m uvicorn main:app --host 0.0.0.0 --port 5000 --reload
```

### Testing AKIRA

```bash
# Health check
curl http://localhost:5000/health | jq .

# Extract RSS
curl -X POST http://localhost:5000/extract \
  -H "Content-Type: application/json" \
  -d '{"url": "https://feeds.bbci.co.uk/news/rss.xml"}' | jq .

# Run tests
python -m pytest tests/ -v
```
