#!/usr/bin/env python3
"""AKIRA Analyst v7.0 - Bias, clustering, categorization."""
import sqlite3, json, time, os, re, urllib.request

AKIRA_DB = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
LM_STUDIO = "http://localhost:1234/v1/embeddings"
MODEL = "text-embedding-nomic-embed-text-v1.5"

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

# Check LM Studio connectivity
try:
    test_emb = get_embedding("test")
    print(f"LM Studio: OK ({len(test_emb)} dims)")
except Exception as e:
    print(f"LM Studio ERROR: {e}")
    exit(1)

# Check MiniMax connectivity
try:
    test_resp = call_minimax("Respondé solo OK.", max_tokens=10)
    print(f"MiniMax: OK")
except Exception as e:
    print(f"MiniMax ERROR: {e}")

conn = sqlite3.connect(AKIRA_DB)

# Pass 1
items_pass1 = conn.execute("""
    SELECT id, title, summary, source_ids, published_at
    FROM news_cards
    WHERE category IS NULL AND bias_score = 0.0
    ORDER BY published_at DESC
    LIMIT 100
""").fetchall()

# Pass 2
items_pass2 = conn.execute("""
    SELECT id, title, summary, source_ids, published_at
    FROM news_cards
    WHERE bias_score IS NULL
    ORDER BY published_at DESC
    LIMIT 100
""").fetchall()
conn.close()

print(f"Pass 1 (embedding-only): {len(items_pass1)} items")
print(f"Pass 2 (full cascade): {len(items_pass2)} items")

if not items_pass1 and not items_pass2:
    print("[SILENT]")
    exit(0)

start = time.time()

# Phase 1: Embeddings
print("Phase 1: Embedding classification...")
cat_embeddings = {cat: get_embedding(cat) for cat in CATEGORIES}

results_pass1 = []
for item_id, title, summary, sources, published in items_pass1:
    if not title:
        continue
    emb = get_embedding(f"{title}. {summary[:500] if summary else ''}")
    cat = max(CATEGORIES, key=lambda c: cosine_sim(emb, cat_embeddings[c]))
    cluster_id = f"cluster-{abs(hash(title)) % (10**8):08x}"
    results_pass1.append((cat, cluster_id, 0.0, "", 0, 0.0, item_id))

print(f"  Pass 1 done: {len(results_pass1)} categorized")

results_pass2 = []
if items_pass2:
    print("Phase 2: Bias detection (MiniMax)...")
    item_embeddings = []
    for item_id, title, summary, sources, published in items_pass2:
        if not title:
            continue
        emb = get_embedding(f"{title}. {summary[:500] if summary else ''}")
        item_embeddings.append((item_id, title, summary, sources, emb))

    for i, (item_id, title, summary, sources, emb) in enumerate(item_embeddings):
        cat = max(CATEGORIES, key=lambda c: cosine_sim(emb, cat_embeddings[c]))
        bias, reasoning, is_gacet, gacet_conf = compute_bias(title, summary, sources or "")
        cluster_id = f"cluster-{abs(hash(title)) % (10**8):08x}"
        results_pass2.append((cat, cluster_id, bias, reasoning, int(is_gacet), gacet_conf, item_id))
        if (i+1) % 5 == 0:
            print(f"  Bias {i+1}/{len(item_embeddings)}...")
        time.sleep(0.3)

# Phase 3: Batch update
print("Phase 3: Updating DB...")
conn2 = sqlite3.connect(AKIRA_DB)
for r in results_pass1:
    conn2.execute("""
        UPDATE news_cards SET
            category = ?, cluster_id = ?, bias_score = ?,
            bias_reasoning = ?, is_gacetilla = ?, gacetilla_confidence = ?
        WHERE id = ?
    """, r)
for r in results_pass2:
    conn2.execute("""
        UPDATE news_cards SET
            category = ?, cluster_id = ?, bias_score = ?,
            bias_reasoning = ?, is_gacetilla = ?, gacetilla_confidence = ?
        WHERE id = ?
    """, r)
conn2.commit()
conn2.close()

elapsed = time.time() - start
total = len(items_pass1) + len(items_pass2)
print(f"\nDone: {total} items ({len(items_pass1)} cat-only, {len(items_pass2)} full) | {elapsed:.1f}s total")