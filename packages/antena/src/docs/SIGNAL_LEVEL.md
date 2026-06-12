# Signal Level Computation

## Overview

Signal level is a 1-10 score representing the estimated newsworthiness and propagation potential of a news card. It is displayed as signal bars in the Antenna feed UI.

## Computation Formula

```
signalLevel = clamp(baseScore + qualityBoost + gacetillaPenalty, 1, 10)
```

### 1. Base Score (from source count)

| Sources | Score |
|---------|-------|
| 1 | 1 |
| 2 | 3 |
| 3 | 4 |
| 4 | 5 |
| 5+ | 6 |
| 10+ | 8 |
| 20+ | 10 |

The `source_ids` field (comma-separated string) is split and counted.

### 2. Quality Boost (from `quality_score`)

The `quality_score` comes from AKIRA's cleaner pipeline (`akira_cleaner.py:compute_quality`), normalized 0.0-1.0:

| Quality Tier | Range | Boost |
|-------------|-------|-------|
| High | ≥ 0.7 | +1 |
| Medium | 0.4–0.7 | 0 |
| Low | < 0.4 | -1 |
| Unscored (NULL) | — | 0 (no penalty) |

Quality score is computed from:
- **Title length**: < 30 chars = -0.15, > 80 = -0.05
- **Summary length**: < 50 chars = -0.25, > 300 = +0.1
- **Category weighting**: Judicial, political, economic = +0.05; entertainment = -0.1
- **Gacetilla (press release)**: -0.35 automatic penalty
- **Extreme bias** (|score| > 0.7): -0.15
- **Rejection patterns** (obituaries, horoscopes, pharmacy shifts, spam, classifieds, paid content): forced to 0.1

### 3. Gacetilla Penalty

Press releases (government/partisan communications) always receive -2 to account for their inherent signal inflation.

## Quality Tiers

Defined in `akira_cleaner.py` and reflected in the dashboard (`main.py:/api/stats/health`):

| Tier | Threshold | Description |
|------|-----------|-------------|
| `high` | ≥ 0.7 | Substantive journalism, proper sourcing |
| `medium` | 0.4–0.7 | Standard news coverage |
| `low` | 0.2–0.4 | Tabloid/clickbait tendency |
| `very_low` | < 0.2 | Spam, press releases, rejected content |

## Feed Filtering

The `/api/news/feed` endpoint accepts `min_quality` parameter (0.0–1.0):

```
GET /api/news/feed?min_quality=0.7
```

Cards with `quality_score >= min_quality` are returned. Unscored cards (NULL) are included by default using `COALESCE(quality_score, 0)` so users see fresh content even before scoring runs.

## Frontend Usage

In Antenna, signal level is computed in `mappers.ts:computeSignalLevel()`:

```typescript
const signalLevel = computeSignalLevel(
  card.source_ids,
  card.quality_score,
  card.is_gacetilla === 1
);
```

It is displayed as 5 animated bars in `NewsCard.tsx`, where filled bars = `ceil(signalLevel / 2)`.
