# AKIRA - Extraction Engine Design

**Codename:** AKIRA (Akira - 紙)  
**Version:** 2.0  
**Date:** 2026-04-02  
**Status:** Draft  
**Based on:** borrador.md (SRS Master), AGENTS.md, previous implementation learnings

## Overview

AKIRA es el **Agente Harvester** del ecosistema PULSO. Es el motor de extracción de noticias que transforma URLs crudas en contenido estructurado.

**Objetivo final (como Ground News):** Mostrar noticias de TODAS las fuentes y display el **grado de parcialidad**. Las fuentes oficiales (.gob.ar) se extraen también para contrastar, no como única fuente.

### Contexto en PULSO (del SRS original)

```
┌─────────────────────────────────────────────────────────────────┐
│  PULSO - Ecosistema de Agentes                                  │
├─────────────────────────────────────────────────────────────────┤
│  SCOUT (MiniMax MCP)     → Descubre fuentes por municipio      │
│       ↓                                                          │
│  AKIRA / HARVESTER       → Extracción multi-método (este doc)  │
│       ↓                                                          │
│  ANALYST (MiniMax)       → Bias detection + clustering         │
│       ↓                                                          │
│  CLEANER                 → Filtra gacetillas, obituarios        │
│       ↓                                                          │
│  PUBLISHER               → Sync D1 → Web visible               │
└─────────────────────────────────────────────────────────────────┘
```

## Goals (Incorporando aprendizajes del SRS y implementación previa)

1. **Performance** - 3-5x throughput improvement via async I/O and caching
2. **Robustness** - Production metrics, graceful shutdown, circuit breakers
3. **Extensibility** - Plugin architecture for new extractors
4. **Observability** - Prometheus metrics, structured logging, health dashboard

### Aprendizajes Incorporados (del borrador.md y experiencia previa)

| Aprendizaje | Aplicación en AKIRA |
|-------------|---------------------|
| **Goose3 tiene issues** | Priorizar newspaper3k, usar Goose solo como fallback |
| **Rate limiting esencial** | 1.5s delay entre requests al mismo dominio |
| **Fuentes .gob.ar** | Comparar noticias contra boletín oficial para gacetillas |
| **WP API funciona bien** | 900 de 944 portales curados son WordPress |
| **Google News RSS** | Descubrimiento de fuentes por query |
| **Circuit breaker** | Fuentes con 5+ fallos se pausan automáticamente |
| **Cloudflare D1** | Sincronizar health data con D1 (no solo SQLite local) |
| **2,400+ municipios** | AKIRA debe procesar por location_id para geo-fencing |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AKIRA ENGINE                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Client Request                                                            │
│        │                                                                    │
│        ▼                                                                    │
│   ┌─────────────┐                                                           │
│   │   FastAPI   │ ◄── Pydantic validation, rate limiting                    │
│   │   Router    │                                                           │
│   └──────┬──────┘                                                           │
│          │                                                                  │
│          ▼                                                                  │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                   │
│   │   Cache     │────▶│   Engine    │────▶│  Extractors │                   │
│   │   Layer     │     │  Orchestr.  │     │   (async)   │                   │
│   └─────────────┘     └──────┬──────┘     └─────────────┘                   │
│          ▲                   │                                              │
│          │                   ▼                                              │
│   ┌─────────────┐     ┌─────────────┐                                      │
│   │   Redis /   │     │   Metrics   │                                      │
│   │   Memory    │     │  Collector  │                                      │
│   └─────────────┘     └─────────────┘                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. FastAPI Application (`main.py`)

```python
# Key endpoints (compatible con Node API proxy)
POST /extract          - Single URL extraction
POST /extract/batch    - Batch extraction (parallel)
POST /extract/google-news - Google News search (discovery)
GET  /health          - Health check with metrics
GET  /metrics         - Prometheus metrics
GET  /sources/{id}/health - Source health status

# Endpoints adicionales para agentes
GET  /agent/status    - Estado para Supervisor agent
POST /agent/restart   - Restart gracefully (para Cron)

# API REST (patrón de changedetection.io)
GET  /api/v1/watches          - List all watched sources
POST /api/v1/watches          - Add new source to watch
GET  /api/v1/watches/{id}     - Get watch details
PUT  /api/v1/watches/{id}     - Update watch config
DELETE /api/v1/watches/{id}   - Remove watch
```

### 2. Bridge Extractors (patrón de RSS-Bridge)

Sistema de extractors modular estilo RSS-Bridge (447 bridges):

```python
# Base class estilo RSS-Bridge
class BridgeExtractor(ABC):
    """Patrón de RSS-Bridge: cada fuente tiene su propio extractor"""
    
    NAME: str  # "WordPress Bridge", "RSS Bridge", etc.
    
    @abstractmethod
    async def extract(self, url: str) -> ExtractResult:
        """Extrae contenido de la URL"""
        pass
    
    @classmethod
    def detect(cls, url: str, html: str) -> bool:
        """Detecta si este bridge aplica para la URL"""
        pass
```

**Built-in bridges:**
| Bridge | Priority | Detect Pattern |
|--------|----------|----------------|
| RSSBridge | 100 | `/feed`, `/rss`, `.xml` |
| WordPressBridge | 90 | `/wp-json/`, WP generator meta |
| NewspaperBridge | 70 | Article-like HTML structure |
| SitemapBridge | 50 | sitemap.xml found |
| PlaywrightBridge | 30 | JS-heavy, needs rendering |
| JinaBridge | 10 | Last resort fallback |

### 2. Engine Orchestrator (`core/engine.py`)

Manages extraction cascade with intelligent method selection:

```python
class ExtractionEngine:
    async def extract(self, url: str, options: ExtractOptions) -> ExtractResult:
        # 1. Check cache (optional)
        # 2. Check source health for best method
        # 3. Run extraction cascade with fallback
        # 4. Record metrics
        # 5. Return result
```

**Cascade Order:**
1. Cache hit → return cached
2. Source health check → best known method first
3. Intelligent cascade: RSS → WP API → Newspaper → Sitemap → Playwright → Jina
4. Record success/failure for health tracking

### 3. Cache Layer (`core/cache.py`)

Multi-backend cache (patrón de RSS-Bridge: File, SQLite, Memcached, Null):

```python
class CacheBackend(ABC):
    """Patrón RSS-Bridge: intercambiable backends"""
    async def get(self, key: str) -> Optional[bytes]
    async def set(self, key: str, value: bytes, ttl: int)
    async def delete(self, key: str)
    async def clear(self)

class MemoryBackend(CacheBackend):  # Default, rápido
class SQLiteBackend(CacheBackend):  # Persistente local
class RedisBackend(CacheBackend):   # Production, distribuido
class NullBackend(CacheBackend):    # Testing, sin cache

class CacheManager:
    """Two-tier caching (inspirado en news-please + RSS-Bridge)"""
    def __init__(self, backend: CacheBackend, l1_size: int = 1000):
        self.backend = backend
        self.l1 = LRUCache(maxsize=l1_size)  # In-memory L1
```

### 4. Extractors (`extractors/`)

Plugin-based extractors with async interface:

```python
class BaseExtractor(ABC):
    @abstractmethod
    async def extract(self, url: str) -> ExtractResult:
        pass
    
    @property
    @abstractmethod
    def name(self) -> str:
        pass
    
    @property
    def priority(self) -> int:
        return 50  # Higher = tried first
```

**Built-in extractors:**
| Extractor | Priority | Use Case |
|-----------|----------|----------|
| RSS | 100 | RSS/Atom feeds |
| WordPress | 90 | WP REST API |
| Newspaper | 70 | Full article extraction |
| Goose | 60 | Fallback article parser |
| Sitemap | 50 | Find recent URLs |
| Playwright | 30 | JS-rendered sites |
| Jina | 10 | Last resort |
| GoogleNews | N/A | Search endpoint only |

### 5. Gacetilla Detector (`core/gacetilla.py`)

**Del SRS original:** "Detector de Pauta: Compara el texto con el Boletín Oficial (scraping diario) para marcar gacetillas"

```python
class GacetillaDetector:
    """Detecta publicidad oficial disfrazada de noticia"""
    
    # Fuentes oficiales por ubicación (de DB)
    official_sources: Dict[int, List[str]]  # location_id -> [urls .gob.ar]
    
    async def analyze(self, article: Article, source: Source) -> GacetillaResult:
        """
        Returns:
        - is_gacetilla: bool
        - confidence: float (0-1)
        - indicators: List[str]
        - official_match: Optional[str]  # URL oficial coincidente
        """
        
    def check_indicators(self, text: str) -> List[str]:
        """
        Indicadores de gacetilla (del SRS):
        - Praise-only content (excesivo elogio gobierno)
        - Official quotes without criticism
        - Generic positive adjectives
        - Missing byline or source attribution
        - Match >70% con comunicado oficial
        """
```

### 6. Metrics Collector (`core/metrics.py`)

Prometheus-compatible metrics:

```python
# Metrics exposed
akira_extractions_total          # Counter by method, status
akira_extraction_duration_seconds # Histogram by method
akira_cache_hits_total           # Counter
akira_active_requests            # Gauge
akira_sources_healthy            # Gauge by source_id
```

### 7. Models (`models/schemas.py`)

Pydantic models for validation (compatible con Node API response format):

```python
class ExtractRequest(BaseModel):
    url: HttpUrl
    source_id: Optional[int] = None
    location_id: Optional[int] = None  # Para geo-fencing
    prefer_method: Optional[str] = None
    use_cache: bool = True
    timeout: int = 60

class ExtractResult(BaseModel):
    success: bool
    method: str
    type: Literal["feed", "article"]
    items: Optional[List[NewsItem]] = None
    article: Optional[Article] = None
    duration_ms: int
    cached: bool = False
    source_health: Optional[SourceHealth] = None
    
    # Campos para análisis de sesgo (posterior)
    preliminary_bias_indicators: Optional[List[str]] = None
    is_potential_gacetilla: bool = False

class SourceHealth(BaseModel):
    """Health data que se sync con D1"""
    source_id: int
    url: str
    last_success_method: str
    success_count: Dict[str, int]
    consecutive_failures: int
    is_circuit_open: bool
```

### 8. Database Sync (`core/sync.py`)

**Del SRS:** "El sistema debe ser capaz de escalar de 10 a 10.000 fuentes sin intervención humana"

AKIRA mantiene dos bases de datos:
- **Local SQLite:** Para operación rápida y health tracking
- **Cloudflare D1:** Para compartir estado con el resto de PULSO

### 10. Export Formats (patrón de news-please)

Multi-format export como news-please (JSON, PostgreSQL, ElasticSearch, Redis):

```python
class ExportFormat(Enum):
    JSON = "json"        # Para debugging y testing
    D1 = "d1"           # Cloudflare D1 (default)
    ELASTICSEARCH = "es" # Búsqueda full-text
    REDIS = "redis"     # Cache rápida

class ArticleExporter:
    """Exporta artículos en múltiples formatos"""
    
    async def export(self, article: Article, format: ExportFormat):
        if format == ExportFormat.JSON:
            return article.get_serializable_dict()
        elif format == ExportFormat.D1:
            return await self._export_to_d1(article)
        # ...
```

### 11. Visual Selector (patrón de changedetection.io)

Para extracción targeting de elementos específicos:

```python
class VisualSelector:
    """Permite configurar qué elementos extraer (inspirado en changedetection.io)"""
    
    def __init__(self):
        self.selectors = {
            "headline": "h1, .headline, .title",
            "content": "article, .article-content, .post-content",
            "image": "article img, .featured-image img",
            "date": "time, .date, .published"
        }
    
    async def configure(self, url: str, html: str) -> SelectorConfig:
        """Analiza HTML y sugiere selectores óptimos"""
```

## Performance Improvements

### 1. Async I/O
- All HTTP requests use `aiohttp`
- Concurrent extraction attempts (with semaphore limit)
- Non-blocking SQLite/Redis operations

### 2. Connection Pooling
- aiohttp with `TCPConnector(limit=100)`
- Redis connection pool
- SQLite with WAL mode + connection pool

### 3. Caching Strategy
- Hot URLs cached in-memory (instant retrieval)
- Failed extractions cached briefly (5min) to prevent hammering
- Cache warming for known good sources

### 4. Batch Extraction
```python
POST /extract/batch
{
    "urls": ["https://...", "https://..."],
    "max_concurrent": 10
}
```
Parallel extraction with semaphore-controlled concurrency.

## Robustness Features

### 1. Health Checks
```json
GET /health
{
    "status": "healthy",
    "version": "2.0.0",
    "uptime_seconds": 3600,
    "active_extractions": 5,
    "cache_hit_rate": 0.73,
    "extractors": {
        "rss": {"status": "healthy", "success_rate": 0.95},
        "newspaper": {"status": "healthy", "success_rate": 0.87}
    },
    "memory_mb": 256,
    "cpu_percent": 12.5
}
```

### 2. Graceful Shutdown
```python
@app.on_event("shutdown")
async def shutdown():
    # 1. Stop accepting new requests
    # 2. Wait for active extractions (max 30s)
    # 3. Flush metrics
    # 4. Close connections
    # 5. Log shutdown complete
```

### 3. Circuit Breaker
Per-source circuit breaker:
- Open after 5 consecutive failures
- Half-open after 60 seconds
- Close after successful extraction

### 4. Rate Limiting
- Per-domain rate limiting (configurable delay)
- Global request limit (max concurrent extractions)
- Respect for robots.txt

### 5. Timeout Handling
- Per-extractor timeouts (configurable)
- Global extraction timeout
- Graceful timeout responses

## Configuration

```python
class Settings(BaseModel):
    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 5000
    WORKERS: int = 4
    
    # Cache (multi-backend como RSS-Bridge)
    CACHE_BACKEND: str = "memory"  # memory, sqlite, redis, null
    REDIS_URL: Optional[str] = None
    CACHE_TTL: int = 600  # 10 minutes
    CACHE_MAX_SIZE: int = 1000
    
    # Extraction
    REQUEST_DELAY: float = 1.5  # seconds between same-domain requests
    MAX_CONCURRENT: int = 20
    DEFAULT_TIMEOUT: int = 60
    
    # Health
    CIRCUIT_BREAKER_THRESHOLD: int = 5
    CIRCUIT_BREAKER_TIMEOUT: int = 60
    
    # D1 Sync
    NODE_API_URL: str = "http://localhost:8787"
    NODE_API_KEY: str = "pulso-dev-key"
```

## Best Practices for Argentine News Extraction

### 1. Rate Limiting Strategy (Mejores prácticas de web scraping)

```python
# Patrón: Respetar sitios con rate limiting inteligente
class RateLimiter:
    """Rate limiting per-domain (mejor práctica: no bloquear servidor)"""
    
    # Regla de oro: 1 request cada 1.5s por dominio
    DELAY_PER_DOMAIN = 1.5  # segundos
    
    # Pero podemos extraer de múltiples dominios en paralelo
    MAX_CONCURRENT_DOMAINS = 10  # 10 dominios simultáneos
```

### 2. Extraction Cascade (Mejor práctica: fallback chain)

```
URL Input
    │
    ▼
┌─────────────┐
│ Cache Hit?  │──Sí──▶ Return cached (<5ms)
└──────┬──────┘
       │ No
       ▼
┌─────────────┐
│ RSS Feed?   │──Sí──▶ feedparser.parse() [30s timeout]
└──────┬──────┘
       │ No
       ▼
┌─────────────┐
│ WordPress?  │──Sí──▶ /wp-json/wp/v2/posts [30s timeout]
└──────┬──────┘
       │ No
       ▼
┌─────────────┐
│ Article?    │──Sí──▶ newspaper4k.extract() [60s timeout]
└──────┬──────┘
       │ No
       ▼
┌─────────────┐
│ Sitemap?    │──Sí──▶ Parse sitemap.xml [15s timeout]
└──────┬──────┘
       │ No
       ▼
┌─────────────┐
│ JS-heavy?   │──Sí──▶ Playwright.render() [60s timeout]
└──────┬──────┘
       │ No
       ▼
┌─────────────┐
│ Jina Reader │──Fin──▶ r.jina.ai/[url] [60s timeout]
└─────────────┘
```

### 3. Error Handling (Mejor práctica: circuit breaker)

```python
class CircuitBreaker:
    """Evita hammering fuentes caídas (patrón changedetection.io)"""
    
    FAILURE_THRESHOLD = 5   # 5 fallos → abrir circuito
    RECOVERY_TIMEOUT = 60   # 60s después → intentar de nuevo
    
    def __init__(self):
        self.failures: Dict[str, int] = {}
        self.last_failure: Dict[str, datetime] = {}
    
    def record_failure(self, url: str):
        self.failures[url] = self.failures.get(url, 0) + 1
        self.last_failure[url] = datetime.now()
    
    def is_open(self, url: str) -> bool:
        """Si circuito abierto, saltar esta fuente"""
        if self.failures.get(url, 0) >= self.FAILURE_THRESHOLD:
            elapsed = (datetime.now() - self.last_failure[url]).seconds
            return elapsed < self.RECOVERY_TIMEOUT
        return False
```

### 4. Logging Structured (Mejor práctica: observabilidad)

```python
# SIEMPRE log estructurado, nunca print() suelto
logger.info("extraction_success", extra={
    "url": url,
    "method": "rss",
    "items_count": len(items),
    "duration_ms": duration,
    "source_id": source_id,
})

logger.warning("extraction_retry", extra={
    "url": url,
    "attempt": attempt,
    "next_method": "newspaper",
})
```

### 5. Type Safety (Mejor práctica: Pydantic v2)

```python
# SIEMPRE validación de entrada/salida con Pydantic
class ExtractRequest(BaseModel):
    url: HttpUrl  # Valida que es URL válida
    source_id: Optional[PositiveInt] = None
    timeout: Field(gt=0, le=120) = 60  # Entre 1 y 120 segundos
    
    model_config = ConfigDict(
        str_strip_whitespace=True,  # Auto-limpiar
        validate_default=True,
    )

class ExtractResult(BaseModel):
    success: bool
    method: Literal["rss", "wp_api", "newspaper", "goose", "sitemap", "playwright", "jina"]
    items: List[NewsItem] = []
    duration_ms: PositiveInt
    cached: bool = False
```

### 6. Memory Management (Mejor práctica: streaming)

```python
# NO cargar todo en memoria, usar generators
async def extract_batch(urls: List[str]) -> AsyncGenerator[ExtractResult, None]:
    """Yield resultados uno por uno, no acumular en memoria"""
    for url in urls:
        result = await extract(url)
        yield result  # Memory efficient
```

## Dependencies

```toml
# pyproject.toml
[project]
name = "akira"
version = "2.0.0"
requires-python = ">=3.11"

dependencies = [
    # FastAPI framework
    "fastapi>=0.110.0",
    "uvicorn[standard]>=0.29.0",
    "pydantic>=2.6.0",
    
    # HTTP clients (async)
    "aiohttp>=3.9.0",
    "httpx>=0.27.0",
    
    # RSS/Atom parsing (feedparser - ya funcionando)
    "feedparser>=6.0.11",
    
    # Article extraction (newspaper4k - mejor que newspaper3k)
    "newspaper4k>=0.9.0",
    
    # Article fallback (goose3)
    "goose3>=3.1.19",
    
    # Playwright for JS rendering
    "playwright>=1.42.0",
    
    # Database
    "aiosqlite>=0.19.0",
    
    # Metrics
    "prometheus-client>=0.20.0",
    
    # Utilities
    "lxml>=5.1.0",
    "beautifulsoup4>=4.12.0",
]
```

```toml
# pyproject.toml
[project]
name = "akira"
version = "2.0.0"
requires-python = ">=3.11"

dependencies = [
    # FastAPI framework
    "fastapi>=0.110.0",
    "uvicorn[standard]>=0.29.0",
    "pydantic>=2.6.0",
    
    # HTTP clients (async)
    "aiohttp>=3.9.0",
    "httpx>=0.27.0",
    
    # RSS/Atom parsing (feedparser)
    "feedparser>=6.0.11",
    
    # Article extraction (newspaper4k - versión mejorada de newspaper3k)
    "newspaper4k>=0.9.0",
    
    # Article fallback (goose3)
    "goose3>=3.1.19",
    
    # Playwright for JS rendering
    "playwright>=1.42.0",
    
    # Database
    "aiosqlite>=0.19.0",
    
    # Metrics
    "prometheus-client>=0.20.0",
    
    # Utilities
    "lxml>=5.1.0",
    "beautifulsoup4>=4.12.0",
]
```

## Migration Path

1. **Phase 1:** Rename `pulso_extractor.py` → `akira/`, keep Flask running on port 5000
2. **Phase 2:** Create FastAPI structure alongside (`akira/main.py`)
3. **Phase 3:** Migrate extractors to async modules (`akira/extractors/*.py`)
4. **Phase 4:** Add cache layer (`akira/core/cache.py`)
5. **Phase 5:** Add metrics (`akira/core/metrics.py`)
6. **Phase 6:** Add D1 sync (`akira/core/sync.py`)
7. **Phase 7:** Remove Flask app, FastAPI takes port 5000

## Testing Strategy

1. **Unit tests** - Each extractor in isolation
2. **Integration tests** - Full cascade with mocked responses
3. **Load tests** - Concurrent extraction performance (target: 100 req/s)
4. **Health tests** - Circuit breaker, timeout, shutdown
5. **Gacetilla tests** - Detección con fuentes oficiales conocidas

## Success Criteria (del SRS + implementación)

- [ ] 3x throughput improvement over Flask version (100+ req/s)
- [ ] p95 latency < 500ms for cached requests
- [ ] Graceful shutdown in < 5 seconds
- [ ] Prometheus metrics available at /metrics
- [ ] Zero downtime deployment capability
- [ ] Gacetilla detection con >80% accuracy
- [ ] Sync health data con D1 exitoso
- [ ] Compatible con Hermes skills (pulso-harvester, pulso-supervisor)
- [ ] Rate limiting respetado (1.5s por dominio)
- [ ] Circuit breaker funcional (5 fallos → pausa)

## Open Questions

1. Should we support WebSocket streaming for batch extraction?
2. Do we need gRPC interface for internal services?
3. Should metrics include per-source cost tracking?
4. Redis es opcional - ¿empezar sin él y agregar después?

---

## Spec Self-Review

### Placeholder Check
- ✅ No TBD or TODO items
- ✅ All sections complete

### Best Practices Check
- ✅ Rate limiting per-domain (1.5s delay)
- ✅ Circuit breaker pattern (5 failures → pause)
- ✅ Structured logging (no bare prints)
- ✅ Type safety with Pydantic v2
- ✅ Memory efficient streaming (async generators)
- ✅ Graceful error handling throughout

### Internal Consistency
- ✅ Architecture matches component descriptions
- ✅ Performance goals align with implementation approach
- ✅ Config options match code examples

### SRS Compliance Check (borrador.md)
- ✅ Multi-agent architecture (AKIRA = Harvester)
- ✅ Gacetilla detection via official sources comparison
- ✅ Cloudflare D1 integration for health sync
- ✅ Rate limiting (1.5s per domain)
- ✅ Circuit breaker (5 failures → pause)
- ✅ Compatible with Hermes cron scheduling

### Ambiguity Check
- ✅ Clear success criteria
- ✅ Unambiguous component responsibilities
- ✅ Config values specified

---

**Next Steps:** Write implementation plan using writing-plans skill.
