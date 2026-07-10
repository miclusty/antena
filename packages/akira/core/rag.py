"""
RAG retrieval + prompt assembly for master article synthesis.

This module ties together three things:
  1. The entity knowledge base (entities, entity_mentions, entity_co_occurrences)
  2. The local vector store (news_embeddings, written by embed_cards.py)
  3. The LM Studio LLM (via core.lmstudio.LMStudioClient)

RAG retrieval is split into three stages:

  Stage A — Vector KNN: embed the cluster's "representative title"
            and find the top-K most similar cards in the vector
            store. These are "related news" — same story, possibly
            from sources not in the original cluster.

  Stage B — Entity graph: for the cluster's top-N most-mentioned
            entities, look at their co-occurrence neighbors. This
            surfaces "what else is usually mentioned alongside
            Milei" — useful for bias perspective synthesis.

  Stage C — Source bias lookup: pull bias_score distribution across
            the cluster. We pass this distribution to the LLM so
            it can produce three distinct perspectives (neutral /
            pro-gov / anti-gov) instead of a single average.

The LLM call is a single chat completion with a structured prompt.
We expect JSON back. If the LLM returns garbage, the caller catches
the parse error and falls back to a keyword summary (see
core.synthesis._fallback_synthesis).

This module is intentionally sync (urllib is the only HTTP dep) so
it can be called from any script. For async use, wrap in
asyncio.to_thread().

Public API:
    RAGEngine.assemble(cluster_id) -> RAGContext
    RAGContext.to_prompt() -> List[Dict[str, str]]   (chat messages)
    RAGEngine.synthesize(cluster_id) -> SynthesizedPerspectives

Where SynthesizedPerspectives is a dataclass with neutral/pro/anti
title + summary, ready to insert into master_articles.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Set, Tuple

import numpy as np

from config import settings
from .lmstudio import LMStudioClient, LMStudioError
from db.connection import get_db_connection

# Spanish stopwords for token-overlap filtering. Hard-coded here
# (not loaded from NLTK) to keep the dep tree small. Covers the
# most common 50 tokens; expand if you see "the" or "is" in your
# top-token-overlap pairs.
_STOPWORDS_ES: Set[str] = {
    "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del",
    "al", "a", "en", "por", "para", "con", "sin", "sobre", "tras",
    "y", "e", "o", "u", "que", "se", "es", "son", "fue", "fueron",
    "ser", "estar", "ha", "han", "había", "hay", "más", "menos",
    "muy", "poco", "mucho", "sí", "no", "si", "ya", "le", "les",
    "lo", "su", "sus", "mi", "mis", "tu", "tus", "este", "esta",
    "estos", "estas", "ese", "esa", "esos", "esas", "aquel",
    "como", "cuando", "donde", "porque", "aunque", "pero", "sin",
    "tras", "desde", "hasta", "ante", "bajo", "entre", "hacia",
    "según", "durante", "mediante", "qué", "cuál", "cómo", "dónde",
}


def _significant_tokens(text: str) -> List[str]:
    """Lowercase, strip punctuation, drop stopwords + short tokens.

    Used by the KNN token-overlap filter to drop neighbors whose
    titles share zero meaningful words with the cluster query.
    """
    if not text:
        return []
    tokens = re.findall(r"[a-záéíóúñü]+", text.lower())
    return [t for t in tokens if len(t) > 2 and t not in _STOPWORDS_ES]

logger = logging.getLogger("akira.rag")

# ─── Configuration ──────────────────────────────────────────────

DB_PATH_DEFAULT = settings.db_path
VECTOR_DIM = 768  # text-embedding-nomic-embed-text-v1.5
TOP_K_NEIGHBORS = 5
TOP_N_ENTITIES = 5
CO_OCCURRENCE_DEPTH = 3
RAG_MODEL = "qwen3.5-4b"

# Re-ranking configuration (Stage D). Uses bge-reranker-base as
# a bi-encoder (embed query + each candidate, cosine rerank).
# Set RERANK_ENABLED = False if bge-reranker-base is not loaded
# in LM Studio.
RERANK_ENABLED = True
RERANK_CANDIDATES = 50   # how many KNN candidates to fetch before re-ranking
RERANK_MODEL = "bge-reranker-base"
TOP_K_NEIGHBORS_FOR_RERANK = 5  # final number after re-ranking

# Bias classification thresholds (from core/clustering.py bias logic).
# bias_score in [-1, +1]: -1 = strongly anti-gov, +1 = strongly pro-gov.
BIAS_PRO_THRESHOLD = 0.2
BIAS_ANTI_THRESHOLD = -0.2

# ─── Data containers ─────────────────────────────────────────────


@dataclass
class RAGContext:
    """Everything needed to prompt the LLM for synthesis.

    The fields are exposed so the caller can introspect them
    (e.g. for the rag_queries audit log) before calling the LLM.
    """
    cluster_id: str
    cluster_articles: List[Dict] = field(default_factory=list)
    neighbor_ids: List[str] = field(default_factory=list)
    neighbor_summaries: List[str] = field(default_factory=list)
    top_entities: List[Tuple[str, int]] = field(default_factory=list)  # (name, count)
    related_entities: List[Tuple[str, int]] = field(default_factory=list)  # (name, count)
    bias_distribution: Dict[str, int] = field(default_factory=dict)  # pro/anti/neutral
    representative_text: str = ""  # title+summary of the cluster centroid

    def to_prompt(self) -> List[Dict[str, str]]:
        """Build the chat messages for the LLM.

        Three sections, separated by horizontal rules:
          1. CONTEXTO: cluster articles (titles + summaries)
          2. RELACIONADO: top-K nearest neighbors + related entities
          3. INSTRUCCIÓN: produce JSON with 3 perspectives

        The LLM is told to respond with strict JSON — no prose
        before/after. We pre-compute everything that can be
        answered without hallucination, and only ask the LLM to
        *write* the master article text in the requested tone.
        """
        articles_text = self._format_articles()
        related_text = self._format_related()
        bias_text = self._format_bias()
        entity_text = self._format_entities()

        system = self._build_system_prompt(
            articles_text=articles_text, related_text=related_text,
            bias_text=bias_text, entity_text=entity_text,
        )
        user = self._build_user_prompt(
            articles_text=articles_text, related_text=related_text,
            bias_text=bias_text, entity_text=entity_text,
        )
        return [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]

    def _build_system_prompt(
        self,
        articles_text: str = "",
        related_text: str = "",
        bias_text: str = "",
        entity_text: str = "",
        perspective: Optional[str] = None,
    ) -> str:
        """Build a system prompt. If `perspective` is None, build
        the default 3-perspective prompt. If perspective is
        'neutral' / 'pro_gov' / 'anti_gov', build a single-
        perspective prompt that asks the LLM to focus on that
        one viewpoint (used by 3-pass self-consistency)."""
        bias = self.bias_distribution
        is_political = (bias.get("pro", 0) + bias.get("anti", 0)) > 0
        if is_political:
            framing = (
                "'pro_gov' (encuadre oficialista, perspectiva del gobierno) "
                "y 'anti_gov' (encuadre opositor, perspectiva crítica al gobierno)"
            )
        else:
            framing = (
                "'pro_gov' (enfoque desde fuentes oficiales/autoridades, "
                "presentando la posición institucional) y 'anti_gov' "
                "(enfoque crítico, escéptico de las versiones oficiales, "
                "centrado en los afectados o versiones alternativas)"
            )

        if perspective is None:
            # Default 3-perspective prompt (1 LLM call)
            return (
                "Sos un asistente editorial que escribe artículos balanceados "
                "sobre noticias argentinas. Respondé ÚNICAMENTE con JSON válido, "
                "sin texto antes ni después. El JSON tiene exactamente 3 claves: "
                f"'neutral', 'pro_gov', 'anti_gov'. Las dos últimas son: {framing}. "
                "Cada una con 'titulo' (string) y 'resumen' (string, 200-400 palabras). "
                "El neutral debe ser estrictamente balanceado, sin adjetivos "
                "valorativos. Las dos últimas deben reflejar encuadres claramente "
                "distintos y reconocibles como tales — no propaganda. pro_gov y "
                "anti_gov NO pueden ser el mismo texto con 1-2 palabras cambiadas; "
                "deben destacar hechos distintos o usar tonos opuestos sobre "
                "el mismo hecho. IMPORTANTE: el CONTEXTO incluye la fuente de cada "
                "noticia entre corchetes (ej. '[Clarín]'). Si citás un hecho, "
                "mencioná la fuente de la que proviene (ej. 'según Clarín', 'para "
                "Página12'). CRÍTICO: usá SOLO la información del CONTEXTO. NO "
                "inventes hechos, personas, lugares ni organizaciones que no "
                "aparezcan explícitamente en el CONTEXTO o en ENTIDADES."
            )
        elif perspective == "neutral":
            return (
                "Sos un periodista argentino que escribe el resumen NEUTRAL "
                "de un evento. Tu trabajo es estrictamente informativo: "
                "presentás los hechos del CONTEXTO sin tomar partido, sin "
                "adjetivos valorativos, sin encuadre ideológico. Respondé "
                "con JSON válido: {\"titulo\": \"...\", \"resumen\": \"...\"}. "
                "El resumen debe ser 200-400 palabras. CRÍTICO: usá SOLO "
                "la información del CONTEXTO. NO inventes hechos, personas, "
                "lugares ni organizaciones que no aparezcan explícitamente en "
                "el CONTEXTO o en ENTIDADES. Si el CONTEXTO no menciona algo, "
                "NO lo menciones."
            )
        elif perspective == "pro_gov":
            if is_political:
                role = "escribís desde la perspectiva del GOBIERNO OFICIAL"
                guidance = (
                    "Destacá los logros y decisiones positivas del gobierno. "
                    "Usá lenguaje positivo/constructivo sobre el actor oficial. "
                    "Si el CONTEXTO tiene hechos positivos para el gobierno, "
                    "resaltalos. Si tiene críticos, mencionalos brevemente sin "
                    "enfatizar. NO inventes logros que no estén en el CONTEXTO."
                )
            else:
                role = "escribís desde la perspectiva de fuentes OFICIALES/AUTORIDADES"
                guidance = (
                    "Presentá la posición institucional. Usá lenguaje que respete "
                    "la versión oficial. Si el CONTEXTO tiene declaraciones de "
                    "autoridades, citá textualmente. Si hay otras versiones en el "
                    "CONTEXTO, mencionalas brevemente como 'versiones alternativas'. "
                    "NO inventes declaraciones oficiales."
                )
            return (
                f"Sos un periodista argentino que {role}. Tu trabajo es "
                f"encuadrar la noticia desde esta perspectiva. {guidance} "
                "Respondé con JSON válido: {\"titulo\": \"...\", \"resumen\": \"...\"}. "
                "El resumen debe ser 200-400 palabras. CRÍTICO: usá SOLO la "
                "información del CONTEXTO. NO inventes hechos, personas, "
                "lugares ni organizaciones que no aparezcan explícitamente en "
                "el CONTEXTO o en ENTIDADES."
            )
        elif perspective == "anti_gov":
            if is_political:
                role = "escribís desde la perspectiva CRÍTICA/OPOSITORA al gobierno"
                guidance = (
                    "Destacá las falencias, contradicciones y aspectos negativos "
                    "del gobierno. Usá lenguaje crítico/escéptico. Si el CONTEXTO "
                    "tiene hechos críticos para el gobierno, resaltalos. Si tiene "
                    "positivos, mencionalos brevemente. NO inventes críticas que "
                    "no estén en el CONTEXTO."
                )
            else:
                role = "escribís desde la perspectiva CRÍTICA/ESCÉPTICA de fuentes independientes"
                guidance = (
                    "Cuestioná la versión oficial. Si el CONTEXTO tiene versiones "
                    "alternativas a la oficial, priorizá esas. Si hay afectados "
                    "o víctimas, centrate en su perspectiva. Usá lenguaje que "
                    "desconfíe de la narrativa institucional. NO inventes "
                    "denuncias o afectados que no estén en el CONTEXTO."
                )
            return (
                f"Sos un periodista argentino que {role}. Tu trabajo es "
                f"encuadrar la noticia desde esta perspectiva. {guidance} "
                "Respondé con JSON válido: {\"titulo\": \"...\", \"resumen\": \"...\"}. "
                "El resumen debe ser 200-400 palabras. CRÍTICO: usá SOLO la "
                "información del CONTEXTO. NO inventes hechos, personas, "
                "lugares ni organizaciones que no aparezcan explícitamente en "
                "el CONTEXTO o en ENTIDADES."
            )
        else:
            raise ValueError(f"unknown perspective: {perspective}")

    def _build_user_prompt(
        self,
        articles_text: str,
        related_text: str,
        bias_text: str,
        entity_text: str,
    ) -> str:
        return (
            f"## CONTEXTO — {len(self.cluster_articles)} noticias del mismo evento:\n"
            f"{articles_text}\n\n"
            f"## RELACIONADO — noticias similares y entidades vinculadas:\n"
            f"{related_text}\n\n"
            f"## SESGO — distribución de encuadre en el cluster:\n"
            f"{bias_text}\n\n"
            f"## ENTIDADES — personas, lugares y organizaciones mencionadas:\n"
            f"{entity_text}\n\n"
            f"## INSTRUCCIÓN:\n"
            f"Escribí las 3 perspectivas como JSON. Recordá: SOLO JSON, sin "
            f"```json``` ni explicaciones."
        )

    def _format_articles(self) -> str:
        """Format the cluster's articles for the prompt. Sorted by
        bias so the LLM sees the bias spectrum explicitly.

        Cluster filtering: if the cluster has at least 4 cards
        with bias_score != 0 (i.e., at least 4 articles that the
        bias detector actually scored), we DROMP the
        bias_score=0 articles. Rationale: those are the
        articles that never got LLM-analyzed (or were scored
        as neutral by the keyword-only bias detector), and
        including them in the synthesis context just adds
        noise — they're typically off-topic cards that the
        clusterer incorrectly grouped with the core event.
        If the cluster has fewer than 4 scored articles, we
        keep them all (we have no signal to filter on).
        """
        scored = [a for a in self.cluster_articles if (a.get("bias_score") or 0.0) != 0.0]
        if len(scored) >= 4:
            articles_to_use = scored
            filter_note = f" (filtrado: {len(self.cluster_articles) - len(scored)} cards sin bias_score excluidas)"
        else:
            articles_to_use = self.cluster_articles
            filter_note = ""

        sorted_articles = sorted(
            articles_to_use,
            key=lambda a: (a.get("bias_score") or 0.0) if a.get("bias_score") is not None else 0.0,
        )
        lines = []
        for i, a in enumerate(sorted_articles, 1):
            bias = a.get("bias_score") or 0.0
            tag = "PRO" if bias > BIAS_PRO_THRESHOLD else ("ANTI" if bias < BIAS_ANTI_THRESHOLD else "NEUTRAL")
            title = (a.get("title") or "").strip()
            summary = (a.get("summary") or "").strip()[:400]
            source = (a.get("source_name") or "").strip()
            # Show source so the LLM can cite "según X". If we
            # don't have a source_name, fall back to "(sin fuente)".
            source_str = f" [{source}]" if source else " [sin fuente]"
            lines.append(
                f"{i}. [{tag} bias={bias:+.2f}]{source_str} {title}\n   {summary}"
            )
        result = "\n\n".join(lines) if lines else "(sin artículos)"
        return result + filter_note

    def _format_related(self) -> str:
        parts = []
        if self.neighbor_summaries:
            parts.append("Noticias similares (vecinos KNN):")
            for i, s in enumerate(self.neighbor_summaries, 1):
                parts.append(f"  {i}. {s[:300]}")
        # Only include related_entities if there are strong
        # co-occurrences (card_count >= 5). At 3-4 they're
        # too noisy — the LLM treats them as facts to mention
        # and they often aren't in the CONTEXTO.
        strong_related = [
            (n, c) for n, c in self.related_entities if c >= 5
        ]
        if strong_related:
            parts.append("\nEntidades relacionadas (co-ocurrencia fuerte):")
            for name, count in strong_related[:5]:
                parts.append(f"  - {name} (aparece junto a la noticia {count} veces)")
        return "\n".join(parts) if parts else "(sin información relacionada)"

    def _format_bias(self) -> str:
        if not self.bias_distribution:
            return "(sin datos de sesgo)"
        pro = self.bias_distribution.get("pro", 0)
        anti = self.bias_distribution.get("anti", 0)
        neutral = self.bias_distribution.get("neutral", 0)
        total = max(pro + anti + neutral, 1)
        return (
            f"  - Pro-gobierno: {pro} ({100*pro/total:.0f}%)\n"
            f"  - Anti-gobierno: {anti} ({100*anti/total:.0f}%)\n"
            f"  - Neutral: {neutral} ({100*neutral/total:.0f}%)"
        )

    def _format_entities(self) -> str:
        """Format the top entities for the prompt.

        We include the top-5 entities by mention count in the
        cluster (filtered to >=2 mentions to drop noise). This
        acts as a soft hint to the LLM about which entities
        the cluster is about, without forcing it to mention
        any specific entity in its output.

        Without this hint, the LLM produces generic summaries.
        With too many entities, the LLM starts hallucinating
        entities that aren't in the CONTEXTO. The 5/2 sweet
        spot was tuned via the eval: at 10/1 the eval showed
        composite 0.61 (hallucination); at 5/2 (current) it
        would be similar; at 0 (no entities) it would lose
        the topical signal entirely.
        """
        if not self.top_entities:
            return "(sin entidades extraídas)"
        return ", ".join(f"{name} ({count})" for name, count in self.top_entities[:5])


@dataclass
class SynthesizedPerspectives:
    """Three perspectives for a single cluster, ready to insert
    into master_articles + clusters.synth_at columns."""
    cluster_id: str
    neutral_title: str
    neutral_summary: str
    pro_gov_title: str
    pro_gov_summary: str
    anti_gov_title: str
    anti_gov_summary: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: int
    neighbors_used: List[str] = field(default_factory=list)
    entities_used: List[str] = field(default_factory=list)


# ─── RAG Engine ──────────────────────────────────────────────────


class RAGEngine:
    """Retrieves context from the knowledge base, prompts the LLM,
    and parses the 3-perspective response.

    All DB access uses the local akira.db (the canonical store for
    embeddings + entities). D1 is only updated after the synthesis
    is done (see main.py / cluster/{id}/synthesize endpoint).
    """

    def __init__(
        self,
        db_path: str = DB_PATH_DEFAULT,
        lm_client: Optional[LMStudioClient] = None,
        top_k: int = TOP_K_NEIGHBORS,
        top_n_entities: int = TOP_N_ENTITIES,
        model: Optional[str] = None,
    ) -> None:
        self.db_path = db_path
        self.lm = lm_client or LMStudioClient()
        self.top_k = top_k
        self.top_n_entities = top_n_entities
        self.model = model or RAG_MODEL

    # ─── Public API ──────────────────────────────────────────

    @staticmethod
    def _safe_float(d: Dict, key: str, default: float = 0.0) -> float:
        """Get a float field from a dict, defaulting to 0.0 if
        missing, None, or non-numeric. Used everywhere we sort
        or compare article fields to avoid TypeErrors on NULL."""
        v = d.get(key, default)
        if v is None:
            return default
        try:
            return float(v)
        except (TypeError, ValueError):
            return default

    def assemble(self, cluster_id: str) -> RAGContext:
        """Build a RAGContext for the given cluster. No LLM call
        is made — this is the cheap "retrieve" stage. The expensive
        "generate" stage is `synthesize()`."""
        ctx = RAGContext(cluster_id=cluster_id)
        ctx.cluster_articles = self._fetch_cluster_articles(cluster_id)
        if not ctx.cluster_articles:
            return ctx
        # SimHash dedup: cluster articles that are near-duplicates of
        # each other (Hamming <= 12) get collapsed — we keep only the
        # longer one. This trims the LLM context and prevents it from
        # weighting multiple phrasings of the same article heavily.
        ctx.cluster_articles = self._dedupe_by_simhash(ctx.cluster_articles)
        ctx.representative_text = self._representative_text(ctx.cluster_articles)
        ctx.neighbor_ids, ctx.neighbor_summaries = self._knn_neighbors(
            ctx.representative_text, exclude_cluster=cluster_id
        )
        ctx.top_entities = self._top_entities_in_cluster(cluster_id)
        ctx.related_entities = self._related_entities(ctx.top_entities)
        ctx.bias_distribution = self._bias_distribution(ctx.cluster_articles)
        return ctx

    def _dedupe_by_simhash(self, articles: List[Dict], threshold: int = 12) -> List[Dict]:
        """Collapse near-duplicate articles by SimHash Hamming distance.

        For each article, compute simhash from title + summary. Keep
        only the longer-content version of any pair within `threshold`
        bits of each other.
        """
        from core.simhash import compute_simhash, hamming_distance
        if len(articles) <= 1:
            return articles
        hashes: List[int] = []
        for a in articles:
            text = f"{a.get('title','')} {a.get('summary','')}"
            hashes.append(compute_simhash(text[:500]))
        kept: List[Dict] = []
        kept_hashes: List[int] = []
        for art, h in zip(articles, hashes):
            is_dup = False
            for kh in kept_hashes:
                if hamming_distance(h, kh) <= threshold:
                    is_dup = True
                    break
            if not is_dup:
                kept.append(art)
                kept_hashes.append(h)
        return kept

    def synthesize(self, cluster_id: str) -> Optional[SynthesizedPerspectives]:
        """Full RAG pipeline: assemble context → prompt LLM → parse.

        This is the 1-pass version: 1 LLM call that produces all
        3 perspectives at once. Cheaper than synthesize_3pass
        but the perspectives tend to be similar (the LLM writes
        them in a single pass with shared wording). The eval
        showed perspective_balance=2.6/5 with this approach.

        We tried an auto-retry (max_retries=1 with temperature
        0.5 on near-duplicate outputs) but it HURT
        perspective_balance (2.6 → 2.0) because the LLM
        became more "creative" but the perspectives were
        less balanced (one short, one long, etc). Removed
        to keep the eval signal clean. If a caller wants
        explicit retry, they can wrap this in their own loop.
        """
        ctx = self.assemble(cluster_id)
        if not ctx.cluster_articles:
            logger.info(f"synth_skip cluster={cluster_id} reason=empty_cluster")
            return None
        messages = ctx.to_prompt()
        t0 = time.monotonic()
        try:
            raw = self.lm.chat(messages, model=self.model, max_tokens=2000, temperature=0.2)
        except LMStudioError as e:
            logger.error(f"synth_failed cluster={cluster_id} reason=lm_studio error={e}")
            return None
        latency_ms = int((time.monotonic() - t0) * 1000)
        parsed = self._parse_perspectives(raw)
        if parsed is None:
            logger.warning(f"synth_bad_json cluster={cluster_id} raw_len={len(raw)}")
            return None
        perspectives = SynthesizedPerspectives(
            cluster_id=cluster_id,
            neutral_title=parsed["neutral"]["titulo"],
            neutral_summary=parsed["neutral"]["resumen"],
            pro_gov_title=parsed["pro_gov"]["titulo"],
            pro_gov_summary=parsed["pro_gov"]["resumen"],
            anti_gov_title=parsed["anti_gov"]["titulo"],
            anti_gov_summary=parsed["anti_gov"]["resumen"],
            model=self.model,
            prompt_tokens=self._estimate_tokens(messages),
            completion_tokens=len(raw.split()),
            latency_ms=latency_ms,
            neighbors_used=ctx.neighbor_ids,
            entities_used=[name for name, _ in ctx.top_entities],
        )
        self._log_query(perspectives)
        return perspectives

    def synthesize_3pass(
        self, cluster_id: str, concurrency: int = 3
    ) -> Optional[SynthesizedPerspectives]:
        """3-pass self-consistency synthesis (design doc §4.3).

        Each perspective gets its OWN LLM call with a perspective-
        specific system prompt. This forces the LLM to commit
        to a single viewpoint per call instead of trying to
        write 3 perspectives at once (where it tends to write
        the same text with 1-2 word changes).

        Pipeline:
          1. assemble() the cluster context
          2. Launch 3 LLM calls in parallel: one for neutral,
             one for pro_gov, one for anti_gov. Each call has
             a system prompt that locks the LLM into that
             perspective and user prompt that includes the
             CONTEXTO + RELACIONADO + SESGO + ENTIDADES.
          3. Parse each call's JSON. If a call fails, fall back
             to the 1-pass synth for that perspective only
             (best-effort).
          4. Compose the SynthesizedPerspectives result from
             the 3 individual outputs.

        Trade-off: 3 LLM calls vs 1, so 3x slower per cluster.
        For 1,167 clusters that's ~5h vs ~2h. The design doc
        §9.1 budget allows this for nightly batch; for
        on-demand, use 1-pass.

        Eval results vs 1-pass (6-cluster golden set):
          + perspective_balance: +0.2 (the 3 perspectives
            are genuinely different — judge saw distinct
            tones and content)
          - faithfulness: -0.3 (3 independent LLM calls
            = 3 chances to hallucinate; the cluster filter
            doesn't help when each call is independent)
          composite: -0.02 (roughly a wash)

        Recommendation: use 1-pass by default, this 3-pass
        when you specifically need distinct perspectives
        (e.g. for the "perspectivas" UI section). Both
        paths are exposed so callers can pick.

        Important: this 3-pass version was tested and FAILED
        to beat 1-pass on the 6-cluster golden set. The
        LLM's bias toward agreement is hard to break with
        system prompt alone. A more productive direction
        is to improve the clusterer (G1) so that the 1-pass
        prompt has more distinct source material to work
        with. Keeping this method around as an opt-in for
        callers who want explicit perspective control.
        """
        import concurrent.futures

        ctx = self.assemble(cluster_id)
        if not ctx.cluster_articles:
            logger.info(f"synth3p_skip cluster={cluster_id} reason=empty_cluster")
            return None
        # _format_* are methods on RAGContext (not on RAGEngine),
        # so we call them via the ctx object.
        articles_text = ctx._format_articles()
        related_text = ctx._format_related()
        bias_text = ctx._format_bias()
        entity_text = ctx._format_entities()

        # Build the shared user prompt (CONTEXTO + RELACIONADO + ...)
        user_prompt = ctx._build_user_prompt(
            articles_text=articles_text,
            related_text=related_text,
            bias_text=bias_text,
            entity_text=entity_text,
        )

        def call_perspective(perspective: str) -> Tuple[str, Optional[Dict]]:
            """One LLM call for one perspective. Returns
            (perspective_name, parsed_dict_or_None)."""
            system = ctx._build_system_prompt(perspective=perspective)
            messages = [
                {"role": "system", "content": system},
                {"role": "user", "content": user_prompt},
            ]
            try:
                raw = self.lm.chat(
                    messages, model=self.model, max_tokens=800, temperature=0.2
                )
            except LMStudioError as e:
                logger.warning(f"synth3p_lm_failed perspective={perspective} err={e}")
                return (perspective, None)
            # Each call returns just one key (the perspective's
            # own). We parse it and wrap into a dict that
            # mimics the 1-pass output shape.
            text = raw.strip()
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
            start = text.find("{")
            end = text.rfind("}")
            if start < 0:
                return (perspective, None)
            try:
                data = json.loads(text[start : end + 1] if end > start else text[start:])
            except json.JSONDecodeError:
                # Repair: append } if truncated
                if end <= start:
                    try:
                        data = json.loads(text[start:] + "}")
                    except json.JSONDecodeError:
                        return (perspective, None)
                else:
                    return (perspective, None)
            if not isinstance(data, dict):
                return (perspective, None)
            # The single-perspective LLM call returns a flat
            # dict {titulo, resumen} or a nested one. Accept
            # both and normalize.
            if "titulo" in data and "resumen" in data:
                return (perspective, {"titulo": data["titulo"], "resumen": data["resumen"]})
            # Maybe it's wrapped: {"neutral": {"titulo", "resumen"}}
            for k, v in data.items():
                if isinstance(v, dict) and "titulo" in v and "resumen" in v:
                    return (perspective, {"titulo": v["titulo"], "resumen": v["resumen"]})
            return (perspective, None)

        # Launch the 3 perspective calls in parallel. The
        # LMStudioClient's multi-node LB will distribute the
        # load across both Macs automatically.
        t0 = time.monotonic()
        results: Dict[str, Optional[Dict]] = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as ex:
            futures = {
                ex.submit(call_perspective, p): p
                for p in ("neutral", "pro_gov", "anti_gov")
            }
            for fut in concurrent.futures.as_completed(futures):
                perspective, data = fut.result()
                results[perspective] = data
        latency_ms = int((time.monotonic() - t0) * 1000)

        # Fallback for failed perspectives: use the 1-pass
        # synth's neutral/pro_gov/anti_gov outputs as fallback.
        # This way, a 3-pass failure on one perspective doesn't
        # kill the whole cluster.
        failed = [p for p, d in results.items() if d is None]
        if failed:
            logger.info(
                f"synth3p_partial_fail cluster={cluster_id} failed={failed} "
                f"falling_back_to_1pass"
            )
            one_pass = self.synthesize(cluster_id)
            if one_pass is None:
                logger.error(f"synth3p_total_fail cluster={cluster_id}")
                return None
            # Map: results["pro_gov"] = one_pass.pro_gov etc
            for p in failed:
                if p == "neutral":
                    results[p] = {"titulo": one_pass.neutral_title, "resumen": one_pass.neutral_summary}
                elif p == "pro_gov":
                    results[p] = {"titulo": one_pass.pro_gov_title, "resumen": one_pass.pro_gov_summary}
                elif p == "anti_gov":
                    results[p] = {"titulo": one_pass.anti_gov_title, "resumen": one_pass.anti_gov_summary}
            # Use 1-pass latency as the fallback's share
            latency_ms += one_pass.latency_ms

        # All 3 perspectives are now populated. Compose.
        # The `failed` list was filled in by the fallback path
        # above, so we assert here to satisfy the type checker.
        assert all(results.get(k) is not None for k in ("neutral", "pro_gov", "anti_gov")), (
            f"synth3p_unexpected_missing_results cluster={cluster_id} results={results}"
        )
        # prompt_tokens is the sum across the 3 calls.
        prompt_tokens = self._estimate_tokens([
            {"role": "system", "content": ctx._build_system_prompt(perspective="neutral")},
            {"role": "user", "content": user_prompt},
        ]) * 3  # rough estimate
        completion_tokens = sum(
            len((d.get("resumen") or "").split()) for d in results.values() if d
        )

        perspectives = SynthesizedPerspectives(
            cluster_id=cluster_id,
            neutral_title=results["neutral"]["titulo"],  # type: ignore[index]
            neutral_summary=results["neutral"]["resumen"],  # type: ignore[index]
            pro_gov_title=results["pro_gov"]["titulo"],  # type: ignore[index]
            pro_gov_summary=results["pro_gov"]["resumen"],  # type: ignore[index]
            anti_gov_title=results["anti_gov"]["titulo"],  # type: ignore[index]
            anti_gov_summary=results["anti_gov"]["resumen"],  # type: ignore[index]
            model=self.model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            latency_ms=latency_ms,
            neighbors_used=ctx.neighbor_ids,
            entities_used=[name for name, _ in ctx.top_entities],
        )
        self._log_query(perspectives)
        return perspectives

    # ─── Stage A: KNN over vector store ───────────────────────

    # Minimum cosine similarity to accept a KNN neighbor. Below
    # this, the news is too unrelated and would only confuse the
    # LLM (we observed hallucination on Cuba when the cluster
    # was actually about Argentina; motorcycles when the cluster
    # was about a hantavirus on a cruise ship). 0.70 is strict;
    # tune via rag_queries audit log if too few neighbors are
    # returned.
    KNN_MIN_SIMILARITY = 0.70

    # KNN_FETCH_LIMIT caps how many high-similarity candidates we
    # pull from the table before applying the token-overlap
    # filter. With 13k cards, ~2-5% will pass 0.70, so 200 is
    # plenty. Bigger values just slow the SQL fetch.
    KNN_FETCH_LIMIT = 200

    # MMR (Maximal Marginal Relevance) lambda. 1.0 = pure
    # relevance, 0.0 = pure diversity.
    #
    # The eval showed MMR hurts at every lambda we tried
    # (0.7 and 0.5) because the cluster centroids aren't
    # tight enough — MMR reranks the top-K to be diverse
    # FROM EACH OTHER, but in the process picks neighbors
    # that are topically unrelated to the cluster's core
    # event (e.g. for the Darthés cluster, MMR returned
    # articles about the Pope, youth, communal events).
    # Those off-topic neighbors confused the LLM and
    # dropped faithfulness by 0.4 points.
    #
    # Set to 1.0 to disable MMR until the clusterer
    # produces tighter centroids (G1 fix). At that point
    # MMR can be re-enabled safely because the relevance
    # of all K candidates will be high, and diversity
    # within the top-K will be the dominant signal.
    MMR_LAMBDA = 1.0  # disabled for now; revisit after G1

    def _knn_neighbors(
        self, text: str, exclude_cluster: str
    ) -> Tuple[List[str], List[str]]:
        """Embed `text`, find the top-K nearest cards in news_embeddings,
        return their IDs and a short summary for each. Excludes cards
        from the same cluster (those are already in the cluster context)
        AND drops neighbors below KNN_MIN_SIMILARITY.

        Selection is MMR (Maximal Marginal Relevance): among
        candidates that pass the relevance threshold, greedily
        pick the one that maximizes (lambda * relevance - (1-lambda)
        * max_cosine_to_already_selected). This gives the LLM
        diverse input — without MMR, the top-K are near-duplicates
        and the synthesized perspectives are too similar
        (baseline showed perspective_balance=2.67/5 without MMR).

        Token-overlap filter: we require at least 1 significant
        token shared between neighbor.title and the cluster
        query. This stops embeddings from matching on a single
        common word ("Argentina") in otherwise-unrelated news.
        """
        try:
            query_vec = np.array(self.lm.embed(text), dtype=np.float32)
        except LMStudioError as e:
            logger.warning(f"knn_embed_failed: {e}")
            return [], []
        # Brute-force cosine over the full embeddings table.
        with get_db_connection(self.db_path) as conn:
            rows = conn.execute(
                "SELECT card_id, embedding, model FROM news_embeddings"
            ).fetchall()
        if not rows:
            return [], []
        vecs = np.zeros((len(rows), VECTOR_DIM), dtype=np.float32)
        ids: List[str] = []
        for i, (cid, emb_json, _model) in enumerate(rows):
            try:
                vecs[i] = np.array(json.loads(emb_json), dtype=np.float32)
            except (ValueError, TypeError):
                vecs[i] = 0
            ids.append(cid)
        qnorm = np.linalg.norm(query_vec) + 1e-9
        norms = np.linalg.norm(vecs, axis=1) + 1e-9
        sims = (vecs @ query_vec) / (norms * qnorm)
        order = np.argsort(-sims)
        # Build a token set of the query for the second filter.
        query_tokens = set(_significant_tokens(text))
        cluster_card_ids = {a["id"] for a in self._fetch_cluster_articles_by_id(exclude_cluster)}
        # Collect candidates passing relevance threshold + token filter.
        # We store the (id, summary, vec, sim) tuple so we can do
        # MMR reranking using the full vector.
        candidates: List[Tuple[str, str, np.ndarray, float]] = []
        for idx in order:
            cid = ids[int(idx)]
            if cid in cluster_card_ids:
                continue
            sim = float(sims[int(idx)])
            if sim < self.KNN_MIN_SIMILARITY:
                break
            candidates.append((cid, "", vecs[int(idx)], sim))
            if len(candidates) >= self.KNN_FETCH_LIMIT:
                break
        if not candidates:
            return [], []
        # Fetch titles+summaries to apply the token filter
        with get_db_connection(self.db_path) as conn:
            placeholders = ",".join("?" * len(candidates))
            rows2 = conn.execute(
                f"SELECT id, title, summary FROM news_cards WHERE id IN ({placeholders})",
                [c[0] for c in candidates],
            ).fetchall()
        id_to_row = {r[0]: r for r in rows2}
        # Apply token filter. We keep the candidate's vector so we
        # can do MMR later.
        filtered: List[Tuple[str, str, np.ndarray, float]] = []
        for cid, _, vec, sim in candidates:
            row = id_to_row.get(cid)
            if not row:
                continue
            _, title, summary = row
            neighbor_tokens = set(_significant_tokens(title or ""))
            if query_tokens & neighbor_tokens or len(neighbor_tokens) <= 2:
                # Build the summary string the caller wants
                filtered.append((cid, f"{title}. {summary or ''}", vec, sim))
        # Stage D: Re-rank using bge-reranker-base bi-encoder (if enabled
        # and there are enough candidates). The re-ranker uses cosine
        # between the query and each candidate's embedding computed
        # with bge-reranker-base, which is trained for relevance
        # ranking and gives better results than the nomic-embed used
        # in Stage A KNN. Tests show ~0.21 margin between relevant
        # and irrelevant docs after re-ranking.
        if RERANK_ENABLED and len(filtered) > self.top_k:
            try:
                # Build candidate dicts for the re-ranker
                rerank_candidates = [
                    {"id": cid, "title": summary.split(".")[0] if "." in summary else summary,
                     "summary": summary}
                    for cid, summary, _, _ in filtered[:RERANK_CANDIDATES]
                ]
                reranked = self.lm.rerank(
                    query=text,
                    candidates=rerank_candidates,
                    model=RERANK_MODEL,
                )
                # Pick top-k after re-ranking
                selected_ids = [c["id"] for c in reranked[:self.top_k]]
                # Map back to our tuples
                id_to_filtered = {(cid, summary): (cid, summary, vec, sim)
                                  for cid, summary, vec, sim in filtered}
                final_selected = []
                for cid in selected_ids:
                    for cid2, summary, vec, sim in filtered:
                        if cid2 == cid:
                            final_selected.append((cid, summary, vec, sim))
                            break
                neighbor_ids = [s[0] for s in final_selected[:self.top_k]]
                neighbor_summaries = [s[1] for s in final_selected[:self.top_k]]
                logger.info(
                    f"reranked: re-ranked {len(reranked)} candidates into "
                    f"{len(neighbor_ids)} neighbors (model={RERANK_MODEL})"
                )
                return neighbor_ids, neighbor_summaries
            except Exception as e:
                logger.warning(f"rerank_failed (falling back to MMR): {e}")
                # Fall through to MMR below
        # MMR reranking (fallback when rerank is disabled or fails).
        # Greedy: at each step, pick the candidate
        # with the highest MMR score = lambda * rel - (1-lambda) *
        # max_cosine_to_already_selected.
        selected: List[Tuple[str, str, np.ndarray, float]] = []
        selected_vecs: List[np.ndarray] = []
        for _ in range(self.top_k):
            if not filtered:
                break
            best_idx = -1
            best_score = -float("inf")
            for i, (cid, summary, vec, sim) in enumerate(filtered):
                if not selected_vecs:
                    mmr = sim
                else:
                    # Max cosine to any already-selected
                    max_redundancy = 0.0
                    for svec in selected_vecs:
                        c = float(
                            np.dot(vec, svec)
                            / ((np.linalg.norm(vec) + 1e-9) * (np.linalg.norm(svec) + 1e-9))
                        )
                        if c > max_redundancy:
                            max_redundancy = c
                    mmr = self.MMR_LAMBDA * sim - (1 - self.MMR_LAMBDA) * max_redundancy
                if mmr > best_score:
                    best_score = mmr
                    best_idx = i
            cid, summary, vec, sim = filtered.pop(best_idx)
            selected.append((cid, summary, vec, sim))
            selected_vecs.append(vec)
        neighbor_ids = [s[0] for s in selected]
        neighbor_summaries = [s[1] for s in selected]
        return neighbor_ids, neighbor_summaries

    def _fetch_cluster_articles_by_id(self, cluster_id: str) -> List[Dict]:
        """Lightweight fetch — same as _fetch_cluster_articles but
        pre-loaded so the KNN filter can avoid same-cluster cards."""
        return self._fetch_cluster_articles(cluster_id)

    # ─── Stage B: entity graph traversal ─────────────────────

    def _top_entities_in_cluster(self, cluster_id: str) -> List[Tuple[str, int]]:
        """Most-mentioned entities across cards in this cluster.

        Only returns entities with at least 2 mentions in the
        cluster (single-mention entities are usually noise
        from the LLM entity extractor — 76% of all entities
        have only 1 mention in the corpus). The 'min_mentions'
        threshold cuts the entity list from ~30 to ~5-8 per
        cluster, dramatically reducing prompt noise and
        LLM hallucination on entity names.
        """
        with get_db_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT e.name, COUNT(*) AS cnt
                FROM entity_mentions em
                JOIN entities e ON e.id = em.entity_id
                JOIN news_cards nc ON nc.id = em.card_id
                WHERE nc.cluster_id = ?
                GROUP BY e.id
                HAVING cnt >= 2
                ORDER BY cnt DESC
                LIMIT ?
                """,
                (cluster_id, self.top_n_entities),
            ).fetchall()
        return [(name, cnt) for name, cnt in rows]

    def _related_entities(self, top_entities: List[Tuple[str, int]]) -> List[Tuple[str, int]]:
        """For each top entity, look at its co-occurrence neighbors
        and return the most-frequently co-mentioned entities across
        the whole knowledge base.

        Filters to card_count >= 3 to avoid noise from weak
        co-occurrences. The KB graph has 71,979 edges; without
        the threshold, we'd return up to 50 entities that
        have only 1-2 co-mentions and would pollute the
        prompt.
        """
        if not top_entities:
            return []
        with get_db_connection(self.db_path) as conn:
            ids = [
                r[0] for r in conn.execute(
                    "SELECT id FROM entities WHERE name IN ({})".format(
                        ",".join("?" * len(top_entities))
                    ),
                    [n for n, _ in top_entities],
                ).fetchall()
            ]
        if not ids:
            return []
        # For each top entity, pull its top co-occurrences and aggregate.
        # Only keep neighbors with card_count >= 3 (strong edges only).
        score: Dict[str, int] = {}
        with get_db_connection(self.db_path) as conn:
            for eid in ids:
                rows = conn.execute(
                    """
                    SELECT e2.name, eco.card_count
                    FROM entity_co_occurrences eco
                    JOIN entities e2 ON (
                      (e2.id = eco.entity_b_id AND eco.entity_a_id = ?)
                      OR (e2.id = eco.entity_a_id AND eco.entity_b_id = ?)
                    )
                    WHERE eco.card_count >= 3
                    ORDER BY eco.card_count DESC
                    LIMIT ?
                    """,
                    (eid, eid, CO_OCCURRENCE_DEPTH),
                ).fetchall()
                for name, cnt in rows:
                    score[name] = score.get(name, 0) + cnt
        # Exclude the top entities themselves
        top_names = {n for n, _ in top_entities}
        score = {n: c for n, c in score.items() if n not in top_names}
        return sorted(score.items(), key=lambda kv: -kv[1])[:TOP_K_NEIGHBORS]

    # ─── Stage C: bias distribution ──────────────────────────

    def _bias_distribution(self, articles: List[Dict]) -> Dict[str, int]:
        dist = {"pro": 0, "anti": 0, "neutral": 0}
        for a in articles:
            b = self._safe_float(a, "bias_score")
            if b > BIAS_PRO_THRESHOLD:
                dist["pro"] += 1
            elif b < BIAS_ANTI_THRESHOLD:
                dist["anti"] += 1
            else:
                dist["neutral"] += 1
        return dist

    # ─── Internals ───────────────────────────────────────────

    def _fetch_cluster_articles(self, cluster_id: str) -> List[Dict]:
        """Fetch all cards in the cluster, including source name
        (joined from sources table). The source name is included
        so the LLM can cite "según X" in the synthesis output,
        which improves source_coverage in the eval."""
        with get_db_connection(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT nc.id, nc.title, nc.summary, nc.source_ids,
                       nc.bias_score, nc.bias_reasoning, nc.is_gacetilla,
                       nc.location_id, nc.published_at, nc.source_url,
                       s.name AS source_name
                FROM news_cards nc
                LEFT JOIN sources s ON s.id = CAST(
                    COALESCE(SUBSTR(nc.source_ids, 1,
                        INSTR(REPLACE(nc.source_ids, '|', ',') || ',', ',') - 1), '0') AS INTEGER)
                WHERE nc.cluster_id = ? AND nc.summary IS NOT NULL AND nc.summary != ''
                AND LENGTH(nc.summary) > 30
                ORDER BY nc.bias_score ASC
                """,
                (cluster_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def _representative_text(self, articles: List[Dict]) -> str:
        """Pick the most central article for KNN.

        The old heuristic was "median by bias_score" — but most
        articles have bias_score = 0 (only the LLM-tagged ones
        have nonzero values), so the median was effectively
        random. That gave unrelated neighbors (e.g. hantavirus
        cluster's centroid was a motorcycle article).

        New heuristic: longest title + longest summary. We
        weight on text length because longer articles usually
        have more semantic content, which means the embedding
        model produces a more "centroid-like" vector. If two
        articles tie, we use the median bias_score as a
        secondary signal.
        """
        if not articles:
            return ""
        # Primary key: total text length (longer = more informative
        # embedding). Descending — biggest first.
        def text_len(a: Dict) -> int:
            return len((a.get("title") or "") + (a.get("summary") or ""))

        articles_sorted = sorted(
            articles,
            key=lambda a: (text_len(a), (a.get("bias_score") or 0.0) if a.get("bias_score") is not None else 0.0),
            reverse=True,
        )
        # Take the top-3 by length and concatenate. A single
        # article's embedding can be biased toward the
        # writer's framing; concatenating 3 of the cluster's
        # most informative articles gives a more robust
        # centroid that the LLM can use to find the right
        # neighbors.
        top_n = min(3, len(articles_sorted))
        parts = [
            f"{a.get('title', '')}. {a.get('summary', '')}"
            for a in articles_sorted[:top_n]
        ]
        return " ".join(parts)

    def _parse_perspectives(self, raw: str) -> Optional[Dict]:
        """Tolerantly parse the LLM's JSON. Strip ```json fences, find
        the outermost {...}, and validate the 3 required keys.

        We ALWAYS require neutral/pro_gov/anti_gov as the 3 keys
        (even for non-political clusters — the system prompt's
        'oficial'/'critico' labels are just narrative hints to
        the LLM; the JSON shape stays the same so the downstream
        schema in master_articles doesn't need branching).

        Repair strategy: if the first json.loads fails, try
        common repairs before giving up:
          1. Truncated JSON (no closing brace) → append "}}"
          2. Trailing comma → strip before }
          3. Single-quote strings → replace with double quotes
        If all repairs fail, return None (the caller logs
        the bad raw and skips the cluster).
        """
        text = raw.strip()
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        # 1st attempt: extract outermost {...}
        start = text.find("{")
        end = text.rfind("}")
        if start < 0:
            return None
        candidate = text[start : end + 1] if end > start else text[start:]
        data = self._try_parse_json(candidate)
        if data is None:
            # 2nd attempt: maybe the JSON was truncated mid-key —
            # try to recover by appending a closing brace.
            if not candidate.endswith("}"):
                data = self._try_parse_json(candidate + "}")
            if data is None:
                # 3rd attempt: trailing comma before }
                repaired = re.sub(r",(\s*[}\]])", r"\1", candidate)
                data = self._try_parse_json(repaired)
            if data is None:
                # 4th attempt: single-quoted JSON (rare but happens)
                repaired = candidate.replace("'", '"')
                data = self._try_parse_json(repaired)
        if data is None:
            return None
        # Validate shape
        for key in ("neutral", "pro_gov", "anti_gov"):
            if key not in data:
                return None
            if not isinstance(data[key], dict):
                return None
            if "titulo" not in data[key] or "resumen" not in data[key]:
                return None
        return data

    def _try_parse_json(self, text: str) -> Optional[Dict]:
        """json.loads with a tight exception catch. Returns None
        on any failure (parse error, non-dict result, etc)."""
        try:
            data = json.loads(text)
        except (json.JSONDecodeError, ValueError):
            return None
        if not isinstance(data, dict):
            return None
        return data

    def _estimate_tokens(self, messages: Sequence[Dict]) -> int:
        """Rough token estimate: ~1.3 tokens per word for English,
        ~1.5 for Spanish. We use this for the audit log; it's not
        meant to be exact."""
        words = sum(len(m["content"].split()) for m in messages)
        return int(words * 1.5)

    def _log_query(self, p: SynthesizedPerspectives) -> None:
        """Write to rag_queries audit table. Best-effort: if the
        table doesn't exist yet, log a warning and skip."""
        try:
            with get_db_connection(self.db_path) as conn:
                conn.execute(
                    """
                    INSERT INTO rag_queries
                        (cluster_id, model, prompt_tokens, completion_tokens,
                         neighbors_used, entities_used, perspectives, latency_ms)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        p.cluster_id,
                        p.model,
                        p.prompt_tokens,
                        p.completion_tokens,
                        json.dumps(p.neighbors_used),
                        json.dumps(p.entities_used),
                        json.dumps({
                            "neutral": {"titulo": p.neutral_title, "resumen": p.neutral_summary},
                            "pro_gov": {"titulo": p.pro_gov_title, "resumen": p.pro_gov_summary},
                            "anti_gov": {"titulo": p.anti_gov_title, "resumen": p.anti_gov_summary},
                        }),
                        p.latency_ms,
                    ),
                )
        except sqlite3.OperationalError as e:
            logger.warning(f"rag_log_failed (table missing?): {e}")
