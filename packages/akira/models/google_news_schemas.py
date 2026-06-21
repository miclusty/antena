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
    error: Optional[str] = None


class GoogleNewsBatchResult(BaseModel):
    """Result for batch Google News extraction."""

    success: bool
    total_locations: int
    total_items: int
    results: List[dict]
    duration_ms: int
    error: Optional[str] = None


class MethodStats(BaseModel):
    """Method learning statistics."""

    total_sources_tracked: int
    circuit_open_sources: int
    method_distribution: dict
