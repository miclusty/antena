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

from .lmstudio import LMStudioClient, LMStudioError

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

DB_PATH_DEFAULT = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
VECTOR_DIM = 768  # text-embedding-nomic-embed-text-v1.5
TOP_K_NEIGHBORS = 5
TOP_N_ENTITIES = 5
CO_OCCURRENCE_DEPTH = 3
RAG_MODEL = "qwen3.5-4b"

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

        system = (
            "Sos un asistente editorial que escribe artículos neutrales "
            "y balanceados sobre noticias argentinas. Respondé ÚNICAMENTE "
            "con JSON válido, sin texto antes ni después. El JSON debe tener "
            "exactamente las 3 claves: 'neutral', 'pro_gov', 'anti_gov'. "
            "Cada una con 'titulo' (string) y 'resumen' (string, 200-400 palabras). "
            "El neutral debe ser estrictamente balanceado, sin adjetivos "
            "valorativos. El pro_gov debe reflejar el encuadre de medios "
            "oficialistas. El anti_gov debe reflejar el encuadre de medios "
            "opositores. Ambos sesgados deben ser reconocibles como tales, "
            "no propaganda. Usá solo la información del CONTEXTO, sin inventar "
            "hechos."
        )

        user = (
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

        return [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]

    def _format_articles(self) -> str:
        """Format the cluster's articles for the prompt. Sorted by
        bias so the LLM sees the bias spectrum explicitly."""
        sorted_articles = sorted(
            self.cluster_articles,
            key=lambda a: a.get("bias_score", 0.0),
        )
        lines = []
        for i, a in enumerate(sorted_articles, 1):
            bias = a.get("bias_score", 0.0)
            tag = "PRO" if bias > BIAS_PRO_THRESHOLD else ("ANTI" if bias < BIAS_ANTI_THRESHOLD else "NEUTRAL")
            title = (a.get("title") or "").strip()
            summary = (a.get("summary") or "").strip()[:400]
            lines.append(f"{i}. [{tag} bias={bias:+.2f}] {title}\n   {summary}")
        return "\n\n".join(lines) if lines else "(sin artículos)"

    def _format_related(self) -> str:
        parts = []
        if self.neighbor_summaries:
            parts.append("Noticias similares (vecinos KNN):")
            for i, s in enumerate(self.neighbor_summaries, 1):
                parts.append(f"  {i}. {s[:300]}")
        if self.related_entities:
            parts.append("\nEntidades relacionadas (co-ocurrencia):")
            for name, count in self.related_entities:
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
        if not self.top_entities:
            return "(sin entidades extraídas)"
        return ", ".join(f"{name} ({count})" for name, count in self.top_entities)


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
    ) -> None:
        self.db_path = db_path
        self.lm = lm_client or LMStudioClient()
        self.top_k = top_k
        self.top_n_entities = top_n_entities

    # ─── Public API ──────────────────────────────────────────

    def assemble(self, cluster_id: str) -> RAGContext:
        """Build a RAGContext for the given cluster. No LLM call
        is made — this is the cheap "retrieve" stage. The expensive
        "generate" stage is `synthesize()`."""
        ctx = RAGContext(cluster_id=cluster_id)
        ctx.cluster_articles = self._fetch_cluster_articles(cluster_id)
        if not ctx.cluster_articles:
            return ctx
        ctx.representative_text = self._representative_text(ctx.cluster_articles)
        ctx.neighbor_ids, ctx.neighbor_summaries = self._knn_neighbors(
            ctx.representative_text, exclude_cluster=cluster_id
        )
        ctx.top_entities = self._top_entities_in_cluster(cluster_id)
        ctx.related_entities = self._related_entities(ctx.top_entities)
        ctx.bias_distribution = self._bias_distribution(ctx.cluster_articles)
        return ctx

    def synthesize(self, cluster_id: str) -> Optional[SynthesizedPerspectives]:
        """Full RAG pipeline: assemble context → prompt LLM → parse."""
        ctx = self.assemble(cluster_id)
        if not ctx.cluster_articles:
            logger.info(f"synth_skip cluster={cluster_id} reason=empty_cluster")
            return None
        messages = ctx.to_prompt()
        t0 = time.monotonic()
        try:
            raw = self.lm.chat(messages, model=RAG_MODEL, max_tokens=2000, temperature=0.2)
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
            model=RAG_MODEL,
            prompt_tokens=self._estimate_tokens(messages),
            completion_tokens=len(raw.split()),
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

    def _knn_neighbors(
        self, text: str, exclude_cluster: str
    ) -> Tuple[List[str], List[str]]:
        """Embed `text`, find the top-K nearest cards in news_embeddings,
        return their IDs and a short summary for each. Excludes cards
        from the same cluster (those are already in the cluster context)
        AND drops neighbors below KNN_MIN_SIMILARITY — these are too
        unrelated to help the synthesis (we observed them introducing
        off-topic content into the LLM output)."""
        try:
            query_vec = np.array(self.lm.embed(text), dtype=np.float32)
        except LMStudioError as e:
            logger.warning(f"knn_embed_failed: {e}")
            return [], []
        # Brute-force cosine over the full embeddings table.
        # SQLite stores embeddings as JSON arrays. We parse on
        # the fly. For 13k × 768 = 10M floats, ~5s in numpy on
        # M4. If we ever need sub-second, switch to ANN
        # (faiss / hnswlib).
        with sqlite3.connect(self.db_path) as conn:
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
        # We require at least 1 significant token overlap between
        # the neighbor's title and the query. This stops embeddings
        # from matching on a single word like "Argentina" in
        # otherwise-unrelated news.
        query_tokens = set(_significant_tokens(text))
        cluster_card_ids = {a["id"] for a in self._fetch_cluster_articles_by_id(exclude_cluster)}
        candidate_ids: List[Tuple[str, float]] = []
        for idx in order:
            cid = ids[int(idx)]
            if cid in cluster_card_ids:
                continue
            sim = float(sims[int(idx)])
            if sim < self.KNN_MIN_SIMILARITY:
                break  # the rest are even lower; we can stop
            candidate_ids.append((cid, sim))
            if len(candidate_ids) >= self.KNN_FETCH_LIMIT:
                break
        if not candidate_ids:
            return [], []
        # Fetch titles for the candidates to apply the token filter
        with sqlite3.connect(self.db_path) as conn:
            placeholders = ",".join("?" * len(candidate_ids))
            rows2 = conn.execute(
                f"SELECT id, title, summary FROM news_cards WHERE id IN ({placeholders})",
                [c[0] for c in candidate_ids],
            ).fetchall()
        id_to_row = {r[0]: r for r in rows2}
        # Keep candidates with at least 1 shared significant token
        # between neighbor.title and the cluster's query. We also
        # accept if the title is short (could be a proper noun).
        neighbor_ids: List[str] = []
        neighbor_summaries: List[str] = []
        for cid, _sim in candidate_ids:
            row = id_to_row.get(cid)
            if not row:
                continue
            _, title, summary = row
            neighbor_tokens = set(_significant_tokens(title or ""))
            # If both queries share a token, or the neighbor
            # has < 3 significant tokens (likely proper noun),
            # accept it.
            if query_tokens & neighbor_tokens or len(neighbor_tokens) <= 2:
                neighbor_ids.append(cid)
                neighbor_summaries.append(f"{title}. {summary or ''}")
                if len(neighbor_ids) >= self.top_k:
                    break
        return neighbor_ids, neighbor_summaries

    def _fetch_cluster_articles_by_id(self, cluster_id: str) -> List[Dict]:
        """Lightweight fetch — same as _fetch_cluster_articles but
        pre-loaded so the KNN filter can avoid same-cluster cards."""
        return self._fetch_cluster_articles(cluster_id)

    # ─── Stage B: entity graph traversal ─────────────────────

    def _top_entities_in_cluster(self, cluster_id: str) -> List[Tuple[str, int]]:
        """Most-mentioned entities across cards in this cluster."""
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT e.name, COUNT(*) AS cnt
                FROM entity_mentions em
                JOIN entities e ON e.id = em.entity_id
                JOIN news_cards nc ON nc.id = em.card_id
                WHERE nc.cluster_id = ?
                GROUP BY e.id
                ORDER BY cnt DESC
                LIMIT ?
                """,
                (cluster_id, self.top_n_entities),
            ).fetchall()
        return [(name, cnt) for name, cnt in rows]

    def _related_entities(self, top_entities: List[Tuple[str, int]]) -> List[Tuple[str, int]]:
        """For each top entity, look at its co-occurrence neighbors
        and return the most-frequently co-mentioned entities across
        the whole knowledge base."""
        if not top_entities:
            return []
        with sqlite3.connect(self.db_path) as conn:
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
        score: Dict[str, int] = {}
        with sqlite3.connect(self.db_path) as conn:
            for eid in ids:
                rows = conn.execute(
                    """
                    SELECT e2.name, eco.card_count
                    FROM entity_co_occurrences eco
                    JOIN entities e2 ON (
                      (e2.id = eco.entity_b_id AND eco.entity_a_id = ?)
                      OR (e2.id = eco.entity_a_id AND eco.entity_b_id = ?)
                    )
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
            b = a.get("bias_score", 0.0) or 0.0
            if b > BIAS_PRO_THRESHOLD:
                dist["pro"] += 1
            elif b < BIAS_ANTI_THRESHOLD:
                dist["anti"] += 1
            else:
                dist["neutral"] += 1
        return dist

    # ─── Internals ───────────────────────────────────────────

    def _fetch_cluster_articles(self, cluster_id: str) -> List[Dict]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT id, title, summary, source_ids, bias_score, bias_reasoning,
                       is_gacetilla, location_id, published_at, source_url
                FROM news_cards
                WHERE cluster_id = ? AND summary IS NOT NULL AND summary != ''
                AND LENGTH(summary) > 30
                ORDER BY bias_score ASC
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
            key=lambda a: (text_len(a), a.get("bias_score", 0.0)),
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
        the outermost {...}, and validate the 3 required keys."""
        text = raw.strip()
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
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
            with sqlite3.connect(self.db_path) as conn:
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
