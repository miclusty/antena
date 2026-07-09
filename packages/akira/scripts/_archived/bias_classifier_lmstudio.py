#!/usr/bin/env python3
# DEPRECATED 2026-06-20: LM Studio-based bias classifier for historical cards.
# Replaced by core.llm_client integration in the pipeline. Bias classification now runs inline during harvest.
# Do NOT run this script unless you know what you're doing. See git history
# for the implementation if you need to revive it.
#
# Original docstring preserved below for reference.
#
"""AKIRA Bias Classifier v2 - Uses LM Studio (qwen3.5-2b) for bias detection.

Replaces the MiniMax-based run_analyst.py with a local-LLM path so we can
process cards without an external API key. Processes ALL cards with
bias_score=0 in one run (not capped at 100).
"""
import sys
import os
# Ensure the akira package root is on the path so `from core.lmstudio`
# works when this script is launched from any cwd.
_PKG_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PKG_ROOT not in sys.path:
    sys.path.insert(0, _PKG_ROOT)

import json
import time
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

AKIRA_DB = os.getenv("AKIRA_DB", str(Path(__file__).parent.parent / "data" / "akira.db"))
LM_STUDIO_CHAT = "http://localhost:1234/v1/chat/completions"
LM_STUDIO_EMBED = "http://localhost:1234/v1/embeddings"
EMBED_MODEL = "text-embedding-nomic-embed-text-v1.5"
CHAT_MODEL = "qwen3.5-2b"

CATEGORIES = ["política", "economía", "deportes", "sociedad", "judiciales",
              "culturales", "tecnología", "internacional", "generales"]


def get_embedding(text: str) -> list:
    """Get embedding from LM Studio. Multi-node if available."""
    try:
        from core.lmstudio import LMStudioClient
        client = LMStudioClient(embed_model=EMBED_MODEL)
        return client.embed(text[:1500])
    except Exception:
        pass
    # Direct fallback
    req = urllib.request.Request(
        LM_STUDIO_EMBED,
        data=json.dumps({"input": text[:1500], "model": EMBED_MODEL}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())["data"][0]["embedding"]


def cosine_sim(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    return dot / ((sum(x * x for x in a) ** 0.5) * (sum(x * x for x in b) ** 0.5) + 1e-9)


def call_lm_studio(prompt: str, max_tokens: int = 200) -> str:
    """Call LM Studio chat completion. Returns the content string.

    Uses the multi-node LMStudioClient which load-balances between
    localhost:1234 and the M5 at 192.168.31.37:1234. Falls back to
    direct urllib if the client can't be imported.
    """
    # Multi-node path: load balance across localhost + M5.
    try:
        from core.lmstudio import LMStudioClient
        client = LMStudioClient(chat_model=CHAT_MODEL)
        return client.chat(
            [{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            temperature=0.2,
        )
    except Exception as e:
        print(f"  bias_lb_fallback: {type(e).__name__}: {e}")

    # Direct fallback to a single URL.
    req = urllib.request.Request(
        LM_STUDIO_CHAT,
        data=json.dumps({
            "model": CHAT_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": 0.2,
        }).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = json.loads(resp.read())
    return raw["choices"][0]["message"].get("content", "")


def compute_bias(title: str, summary: str) -> tuple:
    """Return (bias_score, bias_reasoning, is_gacetilla, gacetilla_conf)."""
    prompt = (
        "Detectá sesgo político en esta noticia argentina.\n"
        f"Título: {title[:200]}\n"
        f"Resumen: {(summary or '')[:500]}\n"
        "Escala: -1.0 (anti-gobierno) a +1.0 (pro-gobierno), 0.0 neutral.\n"
        'Respondé SOLO JSON válido: '
        '{"bias_score": 0.0, "bias_reasoning": "...", "is_gacetilla": false, "gacetilla_confidence": 0.0}'
    )
    try:
        result = call_lm_studio(prompt, max_tokens=200)
        # Strip code fences
        result = re.sub(r"^```(?:json)?\s*", "", result.strip()).strip().rstrip("```").strip()
        start = result.find("{")
        end = result.rfind("}") + 1
        if start != -1 and end > start:
            data = json.loads(result[start:end])
            return (
                float(data.get("bias_score", 0.0)),
                str(data.get("bias_reasoning", ""))[:500],
                bool(data.get("is_gacetilla", False)),
                float(data.get("gacetilla_confidence", 0.0)),
            )
    except Exception as e:
        print(f"  bias_call_error: {type(e).__name__}: {str(e)[:100]}")
    return (0.0, "", False, 0.0)


def categorize(embedding: list, cat_embeddings: dict) -> str:
    return max(CATEGORIES, key=lambda c: cosine_sim(embedding, cat_embeddings[c]))


def cluster_id_for(title: str, summary: str) -> str:
    """Deterministic cluster_id from title (stable across runs)."""
    text = f"{title or ''} {(summary or '')[:100]}"
    return f"c-{abs(hash(text)) % (10 ** 10):010x}"


def process_card(item, cat_embeddings):
    item_id, title, summary = item[0], item[1] or "", item[2] or ""
    if not title:
        return None
    try:
        emb = get_embedding(f"{title[:200]}. {summary[:300]}")
    except Exception:
        emb = None
    cat = categorize(emb, cat_embeddings) if emb else "generales"
    cluster_id = cluster_id_for(title, summary)
    bias, reasoning, is_gacet, gacet_conf = compute_bias(title, summary)
    return (cat, cluster_id, bias, reasoning, int(is_gacet), gacet_conf, item_id)


def main():
    print(f"=== AKIRA Bias Classifier v2 (LM Studio: {CHAT_MODEL}) ===")
    with get_db_connection(AKIRA_DB) as conn:

        # Test LM Studio
        try:
            test_emb = get_embedding("test")
            print(f"LM Studio embeddings: OK ({len(test_emb)} dims)")
        except Exception as e:
            print(f"LM Studio ERROR: {e}")
            return

        # Get ALL cards without bias_score
        items = conn.execute("""
        SELECT id, title, summary
        FROM news_cards
        WHERE bias_score IS NULL OR bias_score = 0.0
        ORDER BY 
            CASE WHEN published_at IS NULL THEN 0 ELSE 1 END DESC,
            published_at DESC
        LIMIT 2000
        """).fetchall()
        print(f"Cards to process: {len(items)}")

    if not items:
        print("[SILENT] no cards to process")
        return

    # Pre-compute category embeddings
    cat_embeddings = {cat: get_embedding(cat) for cat in CATEGORIES}
    print(f"Category embeddings: {len(cat_embeddings)} ready")

    start = time.monotonic()
    results = []
    errors = 0
    with ThreadPoolExecutor(max_workers=int(os.getenv("BIAS_WORKERS", "8"))) as ex:
        futures = {ex.submit(process_card, item, cat_embeddings): item for item in items}
        for fut in as_completed(futures):
            item = futures[fut]
            try:
                r = fut.result()
                if r is not None:
                    results.append(r)
            except Exception as e:
                errors += 1
            if (len(results) + errors) % 25 == 0:
                elapsed = time.monotonic() - start
                rate = (len(results) + errors) / elapsed
                eta = (len(items) - len(results) - errors) / max(rate, 0.01)
                print(f"  [{len(results)+errors}/{len(items)}] ok={len(results)} err={errors} "
                      f"rate={rate:.2f}/s eta={eta:.0f}s", flush=True)

    print(f"\nProcessed {len(results)} cards ({errors} errors) in {time.monotonic()-start:.1f}s")

    # Batch update DB
    print("Updating DB...")
    with get_db_connection(AKIRA_DB) as conn2:
        for r in results:
            conn2.execute("""
                UPDATE news_cards SET
                    category = ?, cluster_id = ?,
                    bias_score = ?, bias_reasoning = ?,
                    is_gacetilla = ?, gacetilla_confidence = ?
                WHERE id = ?
            """, r)
        conn2.commit()
    print(f"Done. {len(results)} cards updated.")


if __name__ == "__main__":
    main()
