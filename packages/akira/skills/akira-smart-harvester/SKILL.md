---
name: akira-smart-harvester
description: When standard extraction fails, uses AI to analyze site structure and generate custom scraping code. Adaptive fallback for custom CMS.
version: 2.0.0
author: AKIRA
license: MIT
metadata:
  hermes:
    tags: [akira, news, argentina, code-generation, adaptive, fallback]
    related_skills: [akira-harvester, akira-supervisor]
---

# AKIRA Smart Harvester v2.0

When standard extraction (RSS → WP → Newspaper → Goose → Sitemap → Playwright → Jina) ALL fail, this skill uses AI to:

1. Analyze the site structure
2. Generate custom scraping code
3. Execute and validate
4. Learn from success/failure

## When to Use

- Standard extraction returns 0 results
- Site uses unusual CMS or custom structure
- Site requires JavaScript rendering
- Site has anti-bot protection

## Workflow

### 1. Analyze the Site

```bash
curl -s -A "Mozilla/5.0" "https://example.com.ar" | head -500
```

### 2. Generate Custom Scraper

Ask Hermes to analyze the HTML and generate a Python scraper:

```
The extraction engine failed to extract news from: https://example.com.ar

Analyze this HTML structure and write a Python script to extract news articles.

Requirements:
1. Extract: title, summary, url, image_url, published_at
2. Handle relative URLs
3. Return JSON array
4. Include error handling
```

### 3. Execute and Validate

```bash
python3 /tmp/custom_extractor.py "https://example.com.ar" > /tmp/extracted.json
cat /tmp/extracted.json | python3 -m json.tool | head -20
```

### 4. Register Successful Extractor

```bash
# Save successful extractor for this domain
mkdir -p /Users/omatic/proyectos/news/packages/akira/extractors/custom
cp /tmp/custom_extractor.py /Users/omatic/proyectos/news/packages/akira/extractors/custom/example.com.ar.py

# Update source health
AKIRA_DB="/Users/omatic/proyectos/news/packages/akira/data/akira.db"
sqlite3 "$AKIRA_DB" "
  UPDATE source_health 
  SET last_success_method = 'custom'
  WHERE source_id = ?
"
```

## Hybrid Strategy

```
LAYER 1: Static Fallbacks (fast, 90% success)
  RSS → WP_API → Newspaper → Goose → Sitemap → Playwright → Jina
  Timeout: 60s total

LAYER 2: Code Generation (slower, handles edge cases)
  AI analyzes HTML structure
  Generates custom scraper
  Tests and validates output

LAYER 3: Manual Flag (human intervention)
  Flag source for manual review
```

## Cron Schedule

Not scheduled automatically. Triggered manually when Harvester reports failures.
