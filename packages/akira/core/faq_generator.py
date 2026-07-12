"""FAQ generation for news clusters.

Given a cluster of articles covering the same event, AKIRA generates 3-5
reader-style Q&A pairs so users can quickly understand "Qué es X?" without
reading every source.

Pipeline:
1. Aggregate article titles + first 200 chars of body into a single prompt
2. Prompt LMStudio (qwen3.5-2b local) to extract Q&A pairs as JSON
3. Parse JSON, validate (non-empty Q, 1-2 sentence A)
4. If LLM fails or returns malformed JSON, fall back to heuristic
   WHO/WHAT/WHEN/WHERE/WHY extraction from titles

Caching: 24h per cluster_id, same pattern as BiasNarrativeCache.
Per user decision 2026-07-10: NO MiniMax fallback. LM Studio only.
"""
from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Iterable

logger = logging.getLogger("akira.faq_generator")


# ─── Spanish interrogative keywords ──────────────────────────────
# Used by the heuristic extractor. Order matters: more specific first.
_INTERROGATIVES = [
    # Quién / Quiénes
    (r"\bqui[eé]n(es)?\b", "quien"),
    # Qué / Qué cosa
    (r"\bqu[eé]\b", "que"),
    # Cuál / Cuáles
    (r"\bcu[aá]l(es)?\b", "cual"),
    # Cuándo
    (r"\bcu[aá]ndo\b", "cuando"),
    # Dónde
    (r"\bd[oó]nde\b", "donde"),
    # Cómo
    (r"\bc[oó]mo\b", "como"),
    # Por qué
    (r"\bpor\s+qu[eé]\b", "porque"),
    # Cuánto/a/os/as
    (r"\bcu[aá]nt[oa]s?\b", "cuanto"),
]

_INTERROGATIVE_RE = re.compile(
    "|".join(f"({p})" for p, _ in _INTERROGATIVES), re.IGNORECASE
)

# Cap on body excerpt per article when building the LLM prompt.
# 200 chars mirrors the bias_narrative pattern.
_BODY_EXCERPT_CHARS = 200

# Default number of FAQs to keep. The spec asks for 3-5; we cap at 5
# and let LLM populate less if the cluster doesn't support more.
DEFAULT_MAX_FAQS = 5
MIN_FAQS = 1

# Maximum answer length (chars). 250 ≈ 2 sentences in Spanish.
MAX_ANSWER_CHARS = 250
# Questions as short as "Q1" or "OK?" are valid for tests/heuristics;
# real LLM output always produces longer Spanish questions.
MIN_QUESTION_CHARS = 2


# ─── Public dataclasses ─────────────────────────────────────────


@dataclass
class FAQ:
    """A single Q&A pair.

    Mirrors the on-disk JSON shape:
        { "question": "...", "answer": "...", "source_count": N }
    """

    question: str
    answer: str
    source_count: int

    def to_dict(self) -> dict:
        return {
            "question": self.question,
            "answer": self.answer,
            "source_count": self.source_count,
        }


# ─── Prompt builder ──────────────────────────────────────────────


def build_prompt(cluster_id: str, articles: list[dict]) -> str:
    """Construct the LLM prompt for FAQ generation.

    Each article is rendered as:
        [source] Title
          <first 200 chars of summary>

    Output format (strict JSON list of objects):
        [{"question": "¿...", "answer": "1-2 oraciones.", "source_count": N}, ...]
    """
    art_lines: list[str] = []
    for a in articles:
        title = (a.get("title") or "").strip()
        summary = (a.get("summary") or "").strip()
        source = (a.get("source") or "unknown").strip()
        excerpt = summary[:_BODY_EXCERPT_CHARS]
        if len(summary) > _BODY_EXCERPT_CHARS:
            excerpt = excerpt.rsplit(" ", 1)[0] + "..."
        line = f"[{source}] {title}"
        if excerpt:
            line += f"\n  {excerpt}"
        art_lines.append(line)
    articles_block = "\n\n".join(art_lines) if art_lines else "(sin artículos)"

    return f"""Sos un editor argentino que ayuda a lectores a entender rápidamente una noticia.

Te paso {len(articles)} artículos argentinos que cubren el mismo hecho. Generá 3-5 preguntas que un lector se haría naturalmente al ver los titulares, con respuestas breves (1-2 oraciones) extraídas directamente de los artículos. Para cada respuesta, indicá cuántas fuentes la respaldan.

Las preguntas deben ser concretas (qué pasó, cuándo, dónde, quiénes, etc.), en español rioplatense, e incluir el signo "?" al final. Si los artículos no cubren algún ángulo, no inventes — devolvé menos preguntas.

Respondé SOLO en JSON (sin markdown fences):
[
  {{"question": "¿Cuándo se votó la reforma?", "answer": "Se votó el 12 de junio en Diputados.", "source_count": 4}},
  {{"question": "¿Qué cambios principales introduce?", "answer": "Sube la edad jubilatoria a 65 años.", "source_count": 3}}
]

Cluster ID: {cluster_id}

Artículos:
{articles_block}

JSON:"""


# ─── Parser + validator ─────────────────────────────────────────


def _validate_faq(faq: Any) -> bool:
    """Validate a single FAQ dict. Returns True if usable."""
    if not isinstance(faq, dict):
        return False
    q = faq.get("question")
    a = faq.get("answer")
    if not isinstance(q, str) or len(q.strip()) < MIN_QUESTION_CHARS:
        return False
    if not isinstance(a, str) or len(a.strip()) == 0:
        return False
    if len(a) > MAX_ANSWER_CHARS:
        return False
    return True


def _clean_faq(faq: dict) -> dict:
    """Normalize a parsed FAQ dict."""
    return {
        "question": str(faq["question"]).strip(),
        "answer": str(faq["answer"]).strip(),
        "source_count": int(faq.get("source_count", 1) or 1),
    }


def parse_llm_response(raw: str) -> list[dict] | None:
    """Parse the LLM JSON response into a validated list of FAQs.

    Tolerates markdown ```json fences. Returns:
        - list (possibly empty) on valid JSON
        - None on malformed JSON (caller decides what to do)
    """
    if not raw:
        return None
    text = raw.strip()
    # Strip markdown fences
    text = re.sub(r"^```json\s*", "", text).strip()
    text = re.sub(r"^```\s*", "", text).strip()
    text = re.sub(r"\s*```$", "", text).strip()

    # Find the JSON list boundaries — handle leading/trailing prose
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        parsed = json.loads(text[start:end + 1])
    except (json.JSONDecodeError, ValueError):
        return None
    if not isinstance(parsed, list):
        return None

    cleaned: list[dict] = []
    for item in parsed:
        if _validate_faq(item):
            cleaned.append(_clean_faq(item))
    return cleaned


# ─── Heuristic fallback ──────────────────────────────────────────


def extract_heuristic_questions(titles: Iterable[str]) -> list[str]:
    """Extract candidate reader questions from article titles.

    Looks for Spanish interrogative words (qué, cuándo, dónde, quién, etc.)
    or question marks. Returns the title rewritten as a question if needed.
    """
    questions: list[str] = []
    seen: set[str] = set()
    for raw in titles:
        if not raw:
            continue
        t = raw.strip()
        if not t:
            continue
        # If the title already has a "?" it's already a question — keep as-is
        if t.endswith("?"):
            q = t
        else:
            # Try to flip a declarative title into a question by finding an
            # interrogative keyword and rephrasing. We don't try to be clever
            # about grammar — we just lift the substring containing the
            # keyword and add a "?".
            m = _INTERROGATIVE_RE.search(t)
            if not m:
                continue
            # Build a minimal question from the matched keyword + a few words
            keyword = m.group(0).lower()
            # Pick a context window of ~6 words around the keyword
            words = t.split()
            try:
                idx = next(i for i, w in enumerate(words) if keyword in w.lower())
            except StopIteration:
                continue
            lo = max(0, idx - 2)
            hi = min(len(words), idx + 5)
            q = " ".join(words[lo:hi]).strip(" ,;:") + "?"
        key = q.lower()
        if key in seen:
            continue
        seen.add(key)
        questions.append(q)
    return questions[:DEFAULT_MAX_FAQS]


def heuristic_fallback(articles: list[dict]) -> list[dict]:
    """Build a list of FAQs from article titles when LLM fails.

    Each title yields a question; the answer is the article summary's
    first sentence (truncated to MAX_ANSWER_CHARS).
    """
    titles = [(a.get("title") or "") for a in articles]
    questions = extract_heuristic_questions(titles)
    if not questions:
        return []
    faqs: list[dict] = []
    for q in questions:
        # Find the article whose title best matches this question
        match = None
        for a in articles:
            t = (a.get("title") or "").lower()
            if q.lower().rstrip("?").split()[0] in t:
                match = a
                break
        if match is None and articles:
            match = articles[0]
        if match is None:
            continue
        summary = (match.get("summary") or "").strip()
        # First sentence
        first_sent = re.split(r"[.!?]+", summary, maxsplit=1)[0].strip()
        if not first_sent:
            first_sent = summary[:100]
        if len(first_sent) > MAX_ANSWER_CHARS:
            first_sent = first_sent[:MAX_ANSWER_CHARS].rsplit(" ", 1)[0] + "..."
        faqs.append({
            "question": q,
            "answer": first_sent,
            "source_count": 1,
        })
    return faqs[:DEFAULT_MAX_FAQS]


# ─── Cache ──────────────────────────────────────────────────────


@dataclass
class FAQCache:
    """In-memory cache for cluster FAQs. 24h TTL (same as NarrativeCache)."""
    ttl_seconds: int = 86400
    _store: dict[str, tuple[float, list[dict]]] = field(default_factory=dict)

    def get(self, cluster_id: str, now: float | None = None) -> list[dict] | None:
        entry = self._store.get(cluster_id)
        if not entry:
            return None
        stored_at, payload = entry
        if (now or time.time()) - stored_at > self.ttl_seconds:
            self._store.pop(cluster_id, None)
            return None
        return payload

    def set(self, cluster_id: str, payload: list[dict], now: float | None = None) -> None:
        self._store[cluster_id] = (now or time.time(), payload)


# ─── Service ────────────────────────────────────────────────────


class FAQGenerator:
    """Orchestrates FAQ generation with caching + fallback.

    Mirrors BiasNarrativeService signature so synthesis.py can wire it
    the same way (try/except around the call, write JSON to cluster row).
    """

    def __init__(
        self,
        llm_client: Any,
        cache: FAQCache | None = None,
        fallback_to_heuristic: bool = True,
        max_faqs: int = DEFAULT_MAX_FAQS,
    ):
        self.llm = llm_client
        self.cache = cache or FAQCache()
        self.fallback_to_heuristic = fallback_to_heuristic
        self.max_faqs = max(1, max_faqs)

    def generate_for_cluster(
        self,
        cluster_id: str,
        articles: list[dict],
        now: float | None = None,
    ) -> dict:
        """Returns {faqs: [...], source: 'llm'|'heuristic'|'cache'|'empty'}.

        Empty articles list short-circuits with source='empty' and no LLM call.
        """
        if not articles:
            return {"faqs": [], "source": "empty", "count": 0}

        cached = self.cache.get(cluster_id, now=now)
        if cached is not None:
            return {"faqs": cached, "source": "cache", "count": len(cached)}

        prompt = build_prompt(cluster_id, articles)
        try:
            raw = self.llm.chat(prompt, max_tokens=600)
            parsed = parse_llm_response(raw)
            if parsed is None:
                raise ValueError("Malformed LLM response")
            # Cap to max_faqs
            parsed = parsed[: self.max_faqs]
            if len(parsed) < MIN_FAQS:
                # LLM returned no valid FAQs — treat as failure
                raise ValueError("LLM produced no valid FAQs")
            self.cache.set(cluster_id, parsed, now=now)
            return {"faqs": parsed, "source": "llm", "count": len(parsed)}
        except Exception as e:
            logger.warning(f"FAQ LLM failed for cluster {cluster_id}: {e}")
            if self.fallback_to_heuristic:
                fb = heuristic_fallback(articles)
                self.cache.set(cluster_id, fb, now=now)
                return {"faqs": fb, "source": "heuristic", "count": len(fb)}
            raise