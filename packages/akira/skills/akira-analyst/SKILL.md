---
name: akira-analyst
description: Analyzes news for bias, clustering, and categorization. Uses local embeddings for fast classification + MiniMax for bias detection. v6.0 - Uses unified akira.db.
version: 6.0.0
author: AKIRA
license: MIT
metadata:
  hermes:
    tags: [akira, news, argentina, analyst, bias, clustering, embeddings]
    related_skills: [akira-harvester, akira-cleaner]
---

# AKIRA Analyst v6.0

Analyzes news in **unified akira.db** — embedding-based classification (local), bias detection (MiniMax), and clustering.

## Architecture

```
akira.db news_cards (bias_score IS NULL)
    ↓
┌─────────────────────────────────────────┐
│  1. EMBEDDING CLASSIFICATION (local)     │  ← ~20ms/item
│     LM Studio /v1/embeddings            │
│     cosine similarity → categoría       │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  2. BIAS DETECTION (MiniMax)            │  ← ~50s/item (API latency)
│     summary as input                     │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  3. CLUSTERING (embeddings)             │  ← ~10ms/item
│     cosine similarity threshold 0.85    │
└─────────────────────────────────────────┘
    ↓
akira.db news_cards (updated: category, bias_score, cluster_id)
```

## Database

```bash
AKIRA_DB="/Users/omatic/proyectos/news/packages/akira/data/akira.db"
```

## Categories

```
política, economía, deportes, sociedad, judiciales, culturales, tecnología, internacional, generales
```

## Workflow

### 1. Get Unanalyzed Items — Two-Pass Cascade

**IMPORTANT:** `bias_score = 0` is a VALID keyword-computed score. The cascade has two distinct blind spots that require separate passes:

- **Pass 1** (`category IS NULL AND bias_score = 0.0`): These are cards where `categorize()` failed OR where `compute_bias()` was never called — embedding-only, no MiniMax needed
- **Pass 2** (`bias_score IS NULL`): Cards that have never been through any analysis pipeline at all — require full MiniMax cascade

```python
import sqlite3
AKIRA_DB = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"

# Pass 1: Embedding-only (fast, no MiniMax) — cards where category is missing but bias_score=0.0
conn = sqlite3.connect(AKIRA_DB)
pass1_items = conn.execute("""
    SELECT id, title, summary, source_ids, published_at
    FROM news_cards
    WHERE category IS NULL AND bias_score = 0.0
    ORDER BY published_at DESC
    LIMIT 100
""").fetchall()
conn.close()

# Pass 2: Full cascade with MiniMax — cards that have never been analyzed
conn = sqlite3.connect(AKIRA_DB)
pass2_items = conn.execute("""
    SELECT id, title, summary, source_ids, published_at
    FROM news_cards
    WHERE bias_score IS NULL
    ORDER BY published_at DESC
    LIMIT 50
""").fetchall()
conn.close()
```

Process Pass 1 first. Only process Pass 2 if Pass 1 is empty or after Pass 1 is drained.

### 2. Embedding Classification (LM Studio local)

```python
import urllib.request, json

LM_STUDIO = "http://localhost:1234/v1/embeddings"
MODEL = "text-embedding-nomic-embed-text-v1.5"

CATEGORIES = ["política", "economía", "deportes", "sociedad", 
              "judiciales", "culturales", "tecnología", "internacional", "generales"]

def get_embedding(text):
    payload = {"input": text, "model": MODEL}
    req = urllib.request.Request(
        LM_STUDIO,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())["data"][0]["embedding"]

def cosine_sim(a, b):
    dot = sum(x*y for x,y in zip(a,b))
    mag_a = sum(x*x for x in a)**0.5
    mag_b = sum(x*x for x in b)**0.5
    return dot / (mag_a * mag_b + 1e-9)

# Pre-compute category embeddings ONCE
category_embeddings = {cat: get_embedding(cat) for cat in CATEGORIES}

def classify_by_embedding(title, summary):
    text = f"{title}. {summary[:500] if summary else ''}"
    emb = get_embedding(text)
    scores = {cat: cosine_sim(emb, cat_emb) for cat, cat_emb in category_embeddings.items()}
    return max(scores, key=scores.get)
```

### 3. Bias Detection (MiniMax)

```python
import re

def call_minimax(prompt, max_tokens=4000):
    """Call MiniMax with proper token limit for JSON output."""
    payload = {
        "model": "MiniMax-M2.7",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0.1
    }
    req = urllib.request.Request(
        "https://api.minimax.io/v1/text/chatcompletion_v2",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {MINIMAX_KEY}", "Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = json.loads(resp.read())
        msg = raw["choices"][0]["message"]
        return msg.get("content") or msg.get("reasoning_content") or ""

def compute_bias(title, summary, sources):
    prompt = (
        f"Detectá sesgo político en esta noticia argentina. "
        f"Título: {title}. "
        f"Resumen: {summary[:500] if summary else ''}. "
        f"Fuentes: {sources or 'No especificadas'}. "
        f"Escala: -1.0 (anti-gobierno) a +1.0 (pro-gobierno), 0.0 neutral. "
        f"JSON solo: "
        '{"bias_score": 0.0, "bias_reasoning": "...", "is_gacetilla": false, "gacetilla_confidence": 0.0}'
    )
    result = call_minimax(prompt, max_tokens=4000)
    result = re.sub(r"^```json\s*", "", result).strip().rstrip("```").strip()
    start = result.find("{")
    end = result.rfind("}") + 1
    if start != -1 and end > start:
        try:
            data = json.loads(result[start:end])
            return (
                float(data.get("bias_score", 0.0)),
                str(data.get("bias_reasoning", "")),
                bool(data.get("is_gacetilla", False)),
                float(data.get("gacetilla_confidence", 0.0))
            )
        except:
            pass
    return (0.0, result[:200], False, 0.0)
```

**CRITICAL:** `max_tokens` must be **≥ 4000**. Below 4000, JSON gets truncated and lands in `reasoning_content`.

### 4. Clustering

```python
def compute_clusters(items, threshold=0.85):
    clusters = {}
    assigned = set()
    for i, (id1, _, _, emb1) in enumerate(items):
        if id1 in assigned:
            continue
        cluster = [id1]
        for j, (id2, _, _, emb2) in enumerate(items[i+1:], i+1):
            if id2 in assigned:
                continue
            if cosine_sim(emb1, emb2) >= threshold:
                cluster.append(id2)
                assigned.add(id2)
        clusters[f"story-{abs(hash(id1)) % (10**8):08x}"] = cluster
        assigned.add(id1)
    return clusters
```

### 5. Batch Update

```python
conn = sqlite3.connect(AKIRA_DB)
for r in results:
    # r = (category, cluster_id, bias_score, bias_reasoning, is_gacetilla, gacetilla_confidence, item_id)
    conn.execute("""
        UPDATE news_cards SET
            category = ?,
            cluster_id = ?,
            bias_score = ?,
            bias_reasoning = ?,
            is_gacetilla = ?,
            gacetilla_confidence = ?
        WHERE id = ?
    """, r)
conn.commit()
conn.close()
```

## Complete Script

```python
#!/usr/bin/env python3
"""AKIRA Analyst v6.0 - Bias, clustering, categorization."""
import sqlite3, json, time, os, re, urllib.request

AKIRA_DB = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
LM_STUDIO = "http://localhost:1234/v1/embeddings"
MODEL = "text-embedding-nomic-embed-text-v1.5"

# Load MiniMax key
MINIMAX_KEY = None
env_path = os.path.expanduser("~/.hermes/.env")
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("MINIMAX_API_KEY=") and not line.startswith("#"):
                key = line.split("=", 1)[1].strip().split()[0].strip('"').strip("'")
                if key and key != "***":
                    MINIMAX_KEY = key
                    break

CATEGORIES = ["política", "economía", "deportes", "sociedad", "judiciales", 
              "culturales", "tecnología", "internacional", "generales"]

def get_embedding(text):
    payload = {"input": text, "model": MODEL}
    req = urllib.request.Request(
        LM_STUDIO,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())["data"][0]["embedding"]

def cosine_sim(a, b):
    dot = sum(x*y for x,y in zip(a,b))
    return dot / ((sum(x*x for x in a)**0.5) * (sum(x*x for x in b)**0.5) + 1e-9)

def call_minimax(prompt, max_tokens=4000):
    payload = {
        "model": "MiniMax-M2.7",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0.1
    }
    req = urllib.request.Request(
        "https://api.minimax.io/v1/text/chatcompletion_v2",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {MINIMAX_KEY}", "Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = json.loads(resp.read())
        msg = raw["choices"][0]["message"]
        return msg.get("content") or msg.get("reasoning_content") or ""

def compute_bias(title, summary, sources):
    prompt = (
        f"Detectá sesgo político en esta noticia argentina. "
        f"Título: {title}. "
        f"Resumen: {summary[:500] if summary else ''}. "
        f"Fuentes: {sources or 'No especificadas'}. "
        f"Escala: -1.0 (anti-gobierno) a +1.0 (pro-gobierno), 0.0 neutral. "
        f"JSON solo: "
        '{"bias_score": 0.0, "bias_reasoning": "...", "is_gacetilla": false, "gacetilla_confidence": 0.0}'
    )
    result = call_minimax(prompt, max_tokens=4000)
    result = re.sub(r"^```json\s*", "", result.strip()).strip().rstrip("```").strip()
    start = result.find("{")
    end = result.rfind("}") + 1
    if start != -1 and end > start:
        try:
            data = json.loads(result[start:end])
            return (
                float(data.get("bias_score", 0.0)),
                str(data.get("bias_reasoning", "")),
                bool(data.get("is_gacetilla", False)),
                float(data.get("gacetilla_confidence", 0.0))
            )
        except:
            pass
    return (0.0, result[:200], False, 0.0)

# Main — Two-Pass Cascade
conn = sqlite3.connect(AKIRA_DB)

# Pass 1: Embedding-only for category=NULL/bias_score=0.0 (fast, no MiniMax)
pass1_items = conn.execute("""
    SELECT id, title, summary, source_ids, published_at
    FROM news_cards
    WHERE category IS NULL AND bias_score = 0.0
    ORDER BY published_at DESC
    LIMIT 100
""").fetchall()

# Pass 2: Full cascade for truly unanalyzed (bias_score IS NULL)
pass2_items = conn.execute("""
    SELECT id, title, summary, source_ids, published_at
    FROM news_cards
    WHERE bias_score IS NULL
    ORDER BY published_at DESC
    LIMIT 50
""").fetchall()
conn.close()

# Process Pass 1 first (embedding-only, no MiniMax bias call)
items = pass1_items if pass1_items else pass2_items
pass_num = 1 if pass1_items else 2
print(f"Using Pass {pass_num}: {len(items)} items (Pass1={len(pass1_items)}, Pass2={len(pass2_items)})")
start = time.time()

# Phase 1: Embeddings
print("Phase 1: Embedding classification...")
cat_embeddings = {cat: get_embedding(cat) for cat in CATEGORIES}
item_embeddings = []
for item_id, title, summary, sources, published in items:
    if not title:
        continue
    emb = get_embedding(f"{title}. {summary[:500] if summary else ''}")
    item_embeddings.append((item_id, title, summary, sources, emb))

# Phase 2: Bias detection (MiniMax — only in Pass 2 or when Pass 1 exhausted)
print("Phase 2: Bias detection (MiniMax)...")
results = []
for i, (item_id, title, summary, sources, emb) in enumerate(item_embeddings):
    cat = max(CATEGORIES, key=lambda c: cosine_sim(emb, cat_embeddings[c]))
    # Only call MiniMax in Pass 2; Pass 1 uses keyword compute_bias only
    if pass_num == 2:
        bias, reasoning, is_gacet, gacet_conf = compute_bias(title, summary, sources or "")
    else:
        bias, reasoning = 0.0, "Pass 1: embedding-only classification"
        is_gacet, gacet_conf = False, 0.0
    cluster_id = f"cluster-{abs(hash(title)) % (10**8):08x}"
    results.append((cat, cluster_id, bias, reasoning, int(is_gacet), gacet_conf, item_id))
    if (i+1) % 5 == 0:
        print(f"  Bias {i+1}/{len(item_embeddings)}...")
    time.sleep(0.3)

# Phase 3: Batch update
print("Phase 3: Updating DB...")
conn2 = sqlite3.connect(AKIRA_DB)
for r in results:
    conn2.execute("""
        UPDATE news_cards SET
            category = ?, cluster_id = ?, bias_score = ?,
            bias_reasoning = ?, is_gacetilla = ?, gacetilla_confidence = ?
        WHERE id = ?
    """, r)
conn2.commit()
conn2.close()

elapsed = time.time() - start
print(f"\nDone: {len(items)} items | {elapsed:.1f}s total")
```

## Cron Schedule

```
hermes cron add --skill akira-analyst --schedule "*/15 * * * *"
```

## Notes

- Embedding model: `text-embedding-nomic-embed-text-v1.5` (768 dims)
- LM Studio must be running on `localhost:1234`
- Bias detection uses MiniMax (only for new items)
- Clustering uses cosine similarity threshold 0.85
- `max_tokens` must be ≥ 4000 to avoid JSON truncation
