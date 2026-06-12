# AKIRA Database Schema

Unified schema for AKIRA v4.0, compatible with both local SQLite and Cloudflare D1.

## Tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| categories | News categories | slug, name, icon |
| locations | Argentine locations (hierarchy) | name, province, type, parent_id |
| sources | News sources with health tracking | name, url, domain, reliability_score, avg_bias |
| seen_urls | URL deduplication for delta extraction | url, source_id, first_seen |
| source_health | Method learning + circuit breaker state | url, last_success_method, consecutive_failures |
| extraction_stats | Per-method performance tracking | url, method, duration_ms, success |
| news_cards | Public-facing news with bias + clustering | title, summary, bias_score, cluster_id, category |
| master_articles | Synthesized neutral articles from clusters | cluster_id, title, summary, bias_min/max/avg |
| metrics | Pipeline execution tracking | skill_name, status, items_processed |

## Entity Relationships

```
locations (1) ──────< (N) sources ──────< (N) seen_urls
     │
     └────────────────< (N) news_cards ──────< (1) cluster_id
                                                    │
                                                    └──────< (1) master_articles
```

## Migration

Run `python scripts/migrate-to-unified-schema.py` to apply schema updates.
Uses `IF NOT EXISTS` — safe to re-run. Auto-creates backup before migrating.
