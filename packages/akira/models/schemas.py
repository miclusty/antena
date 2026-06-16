"""AKIRA Pydantic models for request/response validation."""

from pydantic import BaseModel, HttpUrl, Field
from typing import Optional, List, Literal
from enum import Enum


class MethodName(str, Enum):
    """Extraction method names matching available extractors."""

    RSS = "rss"
    WP_API = "wp_api"
    NEWSPAPER = "newspaper"
    GOOSE = "goose"
    SITEMAP = "sitemap"
    PLAYWRIGHT = "playwright"
    JINA = "jina"
    VIDEO = "video"
    SOCIAL = "social"
    GOOGLE_NEWS = "google_news"


class NewsItem(BaseModel):
    """Parsed news item from RSS feed or web page extraction."""

    title: str = ""
    url: str = ""
    summary: str = ""
    published_at: Optional[str] = None
    image_url: Optional[str] = None
    source: str = ""


class ExtractRequest(BaseModel):
    """Request model for extraction endpoint."""

    url: HttpUrl
    source_id: Optional[int] = None
    location_id: Optional[int] = None
    prefer_method: Optional[MethodName] = None
    use_cache: bool = True
    timeout: int = Field(default=60, gt=0, le=120)


class ExtractResult(BaseModel):
    """Result of an extraction operation."""

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
    """Health check response model."""

    status: Literal["healthy", "degraded", "unhealthy"]
    version: str = "4.0.0"
    uptime_seconds: int
    active_extractions: int
    cache_hit_rate: float
    extractors: dict
    memory_mb: float = 0


class GCStats(BaseModel):
    """Garbage collection statistics."""

    items_collected: int
    memory_freed_mb: float
    last_run: Optional[str] = None
    duration_ms: int


class HealthReport(BaseModel):
    """Detailed health report model."""

    extractor_health: dict
    cache_health: dict
    memory_usage_mb: float
    open_circuits: int
    recommendations: List[str]


class AutoHealResult(BaseModel):
    """Auto-heal operation result model."""

    actions_taken: List[str]
    success: bool
    recommendations: List[str]


# Import Google News models
from models.google_news_schemas import (
    GoogleNewsRequest,
    GoogleNewsBatchRequest,
    GoogleNewsLocationResult,
    GoogleNewsResult,
    GoogleNewsBatchResult,
    MethodStats,
)


class RecoveryStatus(str, Enum):
    RECOVERED = "recovered"
    NOT_FOUND = "not_found"
    ALREADY_ACTIVE = "already_active"
    ERROR = "error"


class RecoveryResult(BaseModel):
    url: str
    status: RecoveryStatus
    method_found: Optional[str] = None
    new_url: Optional[str] = None
    error_message: Optional[str] = None


class RecoveryStats(BaseModel):
    total_failed: int
    recovered: int
    permanently_dead: int


class FailedSource(BaseModel):
    id: int
    name: str
    url: str
    domain: Optional[str] = None
    error_count: int
    last_success: Optional[str] = None


# ═══════════════════════════════════════════
# Synthesis models
# ═══════════════════════════════════════════


class SynthesisResult(BaseModel):
    master_id: str
    cluster_id: str
    title: str
    sources_count: int
    verified_facts_count: int


class BatchSynthesisResult(BaseModel):
    total: int
    success: int
    failed: int
    skipped: int


class MasterArticle(BaseModel):
    id: Optional[str] = None
    cluster_id: str
    title: str
    summary: str
    sources_count: int
    bias_min: Optional[float] = None
    bias_max: Optional[float] = None
    bias_avg: Optional[float] = None
    created_at: Optional[str] = None
    # 3-perspective RAG output. Each perspective has its own
    # title + summary. The `neutral_*` fields duplicate the
    # top-level title/summary so callers that want a single
    # "neutral view" can keep using the existing fields. The
    # `pro_gov_*` and `anti_gov_*` fields are only populated
    # when the cluster was synthesized with the RAG engine.
    neutral_perspective: str = ""
    pro_gov_perspective: str = ""
    anti_gov_perspective: str = ""
    rag_neighbors: int = 0      # how many KNN neighbors were used
    rag_entities: int = 0       # how many top entities were injected
    rag_model: str = ""         # which LLM wrote the perspectives
