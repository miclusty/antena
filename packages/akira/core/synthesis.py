"""AKIRA Synthesis Engine — creates neutral master articles from news clusters.

Architecture:
1. Fact Extraction (no AI, ~50ms/cluster) — regex + frequency counting
2. Perspective Summary (no AI, ~20ms/cluster) — group by bias
3. Synthesis (LLM, ~30s/cluster) — generate neutral article via LLMClient
4. Save to master_articles table

LLM provider selection is delegated to core.llm_client.LLMClient. By default
this uses LM Studio (local); set AKIRA_USE_MINIMAX=1 to use MiniMax cloud API.
The legacy `minimax_api_key` parameter is kept for backward compat — it now
just configures the LLMClient to use MiniMax.
"""

import re
import json
import sqlite3
import logging
import hashlib
from typing import List, Dict, Optional, Any
from datetime import datetime

from db.connection import get_db_connection
from core.llm_client import LLMClient, LLMError

logger = logging.getLogger("akira")

# Patterns for fact extraction
DATE_PATTERN = re.compile(
    r"\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}\s+de\s+\w+\s+de\s+\d{4})\b",
    re.IGNORECASE,
)
MONEY_PATTERN = re.compile(
    r"\$\s*[\d,.]+\s*(millones|mil|billones|M|K)?", re.IGNORECASE
)
PERCENT_PATTERN = re.compile(r"\b\d+[%％]\b")
NUMBER_PATTERN = re.compile(r"\b(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|\d+)\b")
NAME_PATTERN = re.compile(
    r"\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})\b"
)
PLACE_PATTERN = re.compile(
    r"\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ]?[a-záéíóúñ]+)*)\b"
)

# Bias thresholds
BIAS_OFFICIALIST = 0.3
BIAS_OPPOSITION = -0.3


def _primary_source_name(db_path: str, source_ids: str | None) -> str:
    """Look up the first source name for a CSV of source IDs.

    Returns "unknown" if the lookup fails for any reason (missing
    table, bad CSV, deleted source). The detector uses this as the
    dedup key for entries, so consistent failures are fine — they
    just produce a single "unknown"-tagged entry.
    """
    if not source_ids:
        return "unknown"
    try:
        first_id = int(source_ids.split(",")[0].strip())
    except (ValueError, AttributeError):
        return "unknown"
    try:
        with get_db_connection(db_path) as conn:
            row = conn.execute(
                "SELECT name FROM sources WHERE id = ?", (first_id,)
            ).fetchone()
            if row and row["name"]:
                return row["name"]
    except Exception:
        pass
    return "unknown"


class FactExtractor:
    """Extracts facts from a cluster of news articles using regex + frequency counting."""

    def __init__(self, db_path: str):
        self.db_path = db_path

    def get_cluster_articles(self, cluster_id: str) -> List[Dict]:
        """Get all articles in a cluster with their bias info."""
        with get_db_connection(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT id, title, summary, source_ids, bias_score, bias_reasoning,
                       is_gacetilla, location_id, published_at
                FROM news_cards
                WHERE cluster_id = ? AND summary IS NOT NULL AND summary != ''
                AND LENGTH(summary) > 30
                ORDER BY bias_score ASC
            """,
                (cluster_id,),
            ).fetchall()

        # Patterns that indicate low-quality content
        garbage_patterns = [
            re.compile(r"xml\s+version", re.IGNORECASE),
            re.compile(r"<\?xml", re.IGNORECASE),
            re.compile(r"sitemap", re.IGNORECASE),
            re.compile(r"account\s+suspended", re.IGNORECASE),
            re.compile(r"page\s+not\s+found", re.IGNORECASE),
            re.compile(r"404", re.IGNORECASE),
            re.compile(r"sitio\s+no\s+disponible", re.IGNORECASE),
            re.compile(r"intente\s+más\s+tarde", re.IGNORECASE),
            re.compile(r"wp-content", re.IGNORECASE),
            re.compile(r"wp-json", re.IGNORECASE),
            re.compile(r"wordpress", re.IGNORECASE),
            re.compile(r"error\s+establishing\s+a\s+database", re.IGNORECASE),
            re.compile(r"maintenance", re.IGNORECASE),
        ]

        articles = []
        for row in rows:
            summary = row["summary"]
            title = row["title"] or ""

            # Clean HTML tags
            summary = re.sub(r"<[^>]+>", "", summary).strip()
            title = re.sub(r"<[^>]+>", "", title).strip()

            # Skip if too short after cleaning
            if len(summary) < 30:
                continue

            # Skip if matches garbage patterns
            text_to_check = f"{title} {summary}".lower()
            if any(p.search(text_to_check) for p in garbage_patterns):
                continue

            # Skip if title is generic/garbage
            generic_titles = [
                "article",
                "inicio",
                "portada",
                "home",
                "noticia",
                "sin título",
                "untitled",
            ]
            if title.lower().strip() in generic_titles:
                continue

            articles.append(
                {
                    "id": row["id"],
                    "title": title,
                    "summary": summary,
                    "source_ids": row["source_ids"],
                    "bias_score": row["bias_score"] or 0.0,
                    "bias_reasoning": row["bias_reasoning"] or "",
                    "is_gacetilla": bool(row["is_gacetilla"]),
                    "location_id": row["location_id"],
                    "published_at": row["published_at"],
                }
            )
        return articles

    def extract_facts(self, articles: List[Dict]) -> Dict:
        """Extract verified facts, disputed claims, and key entities."""
        if not articles:
            return {
                "verified_facts": [],
                "disputed_claims": [],
                "key_entities": {
                    "dates": [],
                    "money": [],
                    "numbers": [],
                    "names": [],
                    "places": [],
                },
            }

        # Collect all sentences from all articles
        all_sentences = []
        for article in articles:
            text = f"{article['title']}. {article['summary']}"
            # Split into sentences (simple split on period)
            sentences = [
                s.strip() for s in re.split(r"[.!?]+", text) if len(s.strip()) > 10
            ]
            all_sentences.extend([(s, article["bias_score"]) for s in sentences])

        # Normalize sentences for comparison (lowercase, remove punctuation)
        def normalize(s):
            return re.sub(r"[^\w\s]", "", s.lower().strip())

        # Count sentence frequency (with fuzzy matching)
        sentence_groups: Dict[str, Dict[str, Any]] = {}
        for sentence, bias in all_sentences:
            key = normalize(sentence)[:80]  # First 80 chars as key
            if key not in sentence_groups:
                sentence_groups[key] = {"text": sentence, "count": 0, "biases": []}
            sentence_groups[key]["count"] += 1
            sentence_groups[key]["biases"].append(bias)

        # Classify facts
        verified_facts = []
        disputed_claims = []

        for key, group in sentence_groups.items():
            fact = {
                "text": group["text"],
                "frequency": group["count"],
                "bias_range": {
                    "min": min(group["biases"]),
                    "max": max(group["biases"]),
                    "avg": sum(group["biases"]) / len(group["biases"]),
                },
            }

            if group["count"] >= 3:
                # Verified by ≥3 sources
                verified_facts.append(fact)
            else:
                # Only 1-2 sources — disputed or unique claim
                disputed_claims.append(fact)

        # Sort by frequency
        verified_facts.sort(key=lambda x: x["frequency"], reverse=True)
        disputed_claims.sort(key=lambda x: x["frequency"], reverse=True)

        # Extract key entities from verified facts
        entities = self._extract_entities(verified_facts)

        return {
            "verified_facts": verified_facts[:20],  # Top 20
            "disputed_claims": disputed_claims[:15],  # Top 15
            "key_entities": entities,
        }

    def _extract_entities(self, facts: List[Dict]) -> Dict:
        """Extract dates, money, numbers, names, and places from facts."""
        dates = set()
        money = set()
        numbers = set()
        names = set()
        places = set()

        for fact in facts:
            text = fact["text"]
            dates.update(DATE_PATTERN.findall(text))
            money.update(MONEY_PATTERN.findall(text))
            numbers.update(NUMBER_PATTERN.findall(text))
            names.update(NAME_PATTERN.findall(text))
            places.update(PLACE_PATTERN.findall(text))

        return {
            "dates": sorted(dates)[:10],
            "money": sorted(money)[:10],
            "numbers": sorted(numbers)[:10],
            "names": sorted(names)[:15],
            "places": sorted(places)[:10],
        }

    def get_perspectives(self, articles: List[Dict]) -> Dict:
        """Summarize what each bias group says."""
        officialist = [a for a in articles if a["bias_score"] > BIAS_OFFICIALIST]
        opposition = [a for a in articles if a["bias_score"] < BIAS_OPPOSITION]
        neutral = [
            a
            for a in articles
            if BIAS_OPPOSITION <= a["bias_score"] <= BIAS_OFFICIALIST
        ]

        def summarize(group):
            if not group:
                return "Sin fuentes en esta perspectiva"
            # Get the most common themes (first sentences of summaries)
            themes = []
            for a in group[:5]:
                # First sentence of summary
                first_sent = a["summary"].split(".")[0].strip()
                if first_sent:
                    themes.append(first_sent)
            return " | ".join(themes[:3]) if themes else "Sin información"

        return {
            "officialist": {
                "count": len(officialist),
                "summary": summarize(officialist),
                "avg_bias": sum(a["bias_score"] for a in officialist) / len(officialist)
                if officialist
                else 0,
            },
            "opposition": {
                "count": len(opposition),
                "summary": summarize(opposition),
                "avg_bias": sum(a["bias_score"] for a in opposition) / len(opposition)
                if opposition
                else 0,
            },
            "neutral": {
                "count": len(neutral),
                "summary": summarize(neutral),
                "avg_bias": sum(a["bias_score"] for a in neutral) / len(neutral)
                if neutral
                else 0,
            },
        }


class SynthesisEngine:
    """Generates neutral master articles from cluster analysis."""

    def __init__(
        self,
        db_path: str,
        minimax_api_key: Optional[str] = None,
        llm_client: Optional[LLMClient] = None,
    ):
        self.db_path = db_path
        self.fact_extractor = FactExtractor(db_path)
        # Backward compat: if a minimax_api_key is provided but no explicit
        # llm_client, build one that targets MiniMax. Otherwise default to
        # LM Studio (or AKIRA_USE_MINIMAX=1).
        if llm_client is not None:
            self.llm_client = llm_client
        elif minimax_api_key:
            self.llm_client = LLMClient(
                provider="minimax", minimax_api_key=minimax_api_key
            )
        else:
            self.llm_client = LLMClient()

    def synthesize_cluster(self, cluster_id: str) -> Optional[Dict]:
        """
        Full synthesis pipeline for a cluster:
        1. Extract facts
        2. Get perspectives
        3. Call MiniMax for synthesis
        4. Save to master_articles
        """
        # Step 1: Get articles
        articles = self.fact_extractor.get_cluster_articles(cluster_id)
        if len(articles) < 2:
            logger.info(
                f"synthesis_skip cluster={cluster_id} reason=too_few_articles count={len(articles)}"
            )
            return None

        # Step 2: Extract facts (no AI, fast)
        facts = self.fact_extractor.extract_facts(articles)

        # Step 3: Get perspectives (no AI, fast)
        perspectives = self.fact_extractor.get_perspectives(articles)

        # Step 4: Generate synthesis via LLM (LM Studio or MiniMax)
        synthesis = self._call_llm(cluster_id, articles, facts, perspectives)
        if not synthesis:
            return None

        # Step 5: Save to DB
        master_id = self._save_master_article(
            cluster_id, synthesis, facts, perspectives, articles
        )

        logger.info(
            f"synthesis_complete cluster={cluster_id} master_id={master_id} "
            f"sources={len(articles)} facts={len(facts['verified_facts'])}"
        )

        return {
            "master_id": master_id,
            "cluster_id": cluster_id,
            "title": synthesis["title"],
            "sources_count": len(articles),
            "verified_facts_count": len(facts["verified_facts"]),
        }

    def _call_llm(
        self, cluster_id: str, articles: List[Dict], facts: Dict, perspectives: Dict
    ) -> Optional[Dict]:
        """Call the configured LLM (LM Studio by default; MiniMax if configured)
        to generate a neutral synthesis. Returns parsed {title, summary} dict,
        or None if the LLM is unavailable and we fall back to keyword synthesis.
        """
        # Build verified facts text
        facts_text = "\n".join(
            f"- {f['text']} (mencionado por {f['frequency']} fuentes)"
            for f in facts["verified_facts"][:10]
        )

        # Build disputed claims text
        disputed_text = "\n".join(
            f"- {c['text']} (solo {c['frequency']} fuente(s))"
            for c in facts["disputed_claims"][:8]
        )

        # Build perspectives text
        pers_text = f"""
Fuentes oficialistas ({perspectives["officialist"]["count"]}): {perspectives["officialist"]["summary"]}
Fuentes opositoras ({perspectives["opposition"]["count"]}): {perspectives["opposition"]["summary"]}
Fuentes neutrales ({perspectives["neutral"]["count"]}): {perspectives["neutral"]["summary"]}
"""

        prompt = f"""Eres un periodista argentino experto en síntesis neutral de noticias.

Tu tarea es crear UNA noticia neutral y objetiva basada en múltiples fuentes argentinas que cubren el mismo hecho.

HECHOS VERIFICADOS (confirmados por 3+ fuentes):
{facts_text}

CLAIMS DISPUTADOS (solo 1-2 fuentes, pueden ser parciales):
{disputed_text}

PERSPECTIVAS DE CADA LADO:
{pers_text}

Instrucciones:
1. Escribe un título neutral y preciso (sin sensacionalismo)
2. Escribe un resumen de 2-3 párrafos con los hechos verificados
3. Si hay claims disputados, menciónalos como "según algunas fuentes" o "otras fuentes señalan"
4. NO tomes partido por ningún lado
5. Cita las diferentes perspectivas de forma equilibrada
6. Si hay cifras, fechas o nombres clave, inclúyelos

Responde SOLO en formato JSON:
{{"title": "...", "summary": "..."}}"""

        try:
            content = self.llm_client.chat(
                [{"role": "user", "content": prompt}],
                max_tokens=2000,
                temperature=0.1,
                timeout=60.0,
            )
        except LLMError as e:
            logger.error(
                f"synthesis_llm_failed cluster={cluster_id} provider={self.llm_client.provider} error={e}"
            )
            return self._fallback_synthesis(articles, facts, perspectives)

        return self._parse_llm_response(content, articles, facts, perspectives)

    @staticmethod
    def _parse_llm_response(
        content: str,
        articles: List[Dict],
        facts: Dict,
        perspectives: Dict,
    ) -> Dict[str, Any]:
        """Parse the LLM response into {title, summary}. Tolerates markdown
        fences around the JSON, falls back to first sentences if no JSON."""
        # Strip markdown ```json fences if present
        content = (
            re.sub(r"^```json\s*", "", content.strip())
            .strip()
            .rstrip("```")
            .strip()
        )
        start = content.find("{")
        end = content.rfind("}") + 1
        if start != -1 and end > start:
            try:
                parsed: Dict[str, Any] = json.loads(content[start:end])
                return parsed
            except json.JSONDecodeError:
                pass  # fall through to sentence-split fallback

        # Fallback: use first two sentences as title + summary
        sentences = re.split(r"[.!?]+", content)
        title = sentences[0].strip()[:200] if sentences else "Noticia sintetizada"
        summary = ". ".join(sentences[:3]).strip()[:1000]
        return {"title": title, "summary": summary}

    def _fallback_synthesis(
        self, articles: List[Dict], facts: Dict, perspectives: Dict
    ) -> Dict:
        """Generate a basic synthesis without AI (when MiniMax is unavailable)."""
        if not articles:
            return {"title": "Sin información", "summary": ""}

        # Use the most neutral article's title as base
        neutral_articles = [a for a in articles if abs(a["bias_score"]) < 0.2]
        if neutral_articles:
            base = neutral_articles[0]
        else:
            base = articles[len(articles) // 2]

        # Build summary from verified facts
        fact_texts = [f["text"] for f in facts["verified_facts"][:5]]
        if fact_texts:
            summary = ". ".join(fact_texts)
        else:
            # Use summaries from neutral articles
            neutral_summaries = [
                a["summary"] for a in neutral_articles[:3] if a["summary"]
            ]
            summary = (
                " | ".join(neutral_summaries) if neutral_summaries else base["summary"]
            )

        # Clean up title
        title = base["title"]
        # Remove sensationalist prefixes
        title = re.sub(
            r"^(ÚLTIMA HORA|URGENTE|EXCLUSIVO|ALERTA)\s*[-:]\s*",
            "",
            title,
            flags=re.IGNORECASE,
        )
        # Remove XML/HTML
        title = re.sub(r"<[^>]+>", "", title).strip()
        if not title or len(title) < 5:
            title = "Noticia sintetizada por AKIRA"

        # Clean summary
        summary = re.sub(r"<[^>]+>", "", summary).strip()
        summary = summary[:1000]

        return {"title": title, "summary": summary}

    def _save_master_article(
        self,
        cluster_id: str,
        synthesis: Dict,
        facts: Dict,
        perspectives: Dict,
        articles: List[Dict],
    ) -> str:
        """Save the master article to the database."""
        master_id = hashlib.md5(f"master-{cluster_id}".encode()).hexdigest()[:16]

        biases = [a["bias_score"] for a in articles]

        with get_db_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO master_articles
                (id, cluster_id, title, summary, verified_facts, disputed_claims,
                 officialist_perspective, opposition_perspective, neutral_perspective,
                 sources_count, bias_min, bias_max, bias_avg, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            """,
                (
                    master_id,
                    cluster_id,
                    synthesis["title"],
                    synthesis["summary"],
                    json.dumps(facts["verified_facts"], ensure_ascii=False),
                    json.dumps(facts["disputed_claims"], ensure_ascii=False),
                    perspectives["officialist"]["summary"],
                    perspectives["opposition"]["summary"],
                    perspectives["neutral"]["summary"],
                    len(articles),
                    min(biases),
                    max(biases),
                    sum(biases) / len(biases) if biases else 0,
                ),
            )
            conn.commit()

        # Generate bias narrative (background, non-blocking).
        # Writes to clusters.bias_narrative via the local SQLite mirror.
        # Production: a separate Worker cron syncs AKIRA SQLite → D1.
        try:
            from core.bias_narrative import BiasNarrativeService, NarrativeCache
            from core.llm_client import LLMClient

            llm = LLMClient()  # default = LMStudio local
            narrative_svc = BiasNarrativeService(
                llm_client=llm,
                cache=NarrativeCache(),
            )
            # Re-fetch source biases + excerpts for the cluster
            with get_db_connection(self.db_path) as conn:
                src_rows = conn.execute(
                    "SELECT s.name, nc.bias_score FROM news_cards nc "
                    "JOIN sources s ON s.id = nc.source_id "
                    "WHERE nc.cluster_id = ? AND nc.bias_score IS NOT NULL",
                    (cluster_id,),
                ).fetchall()
                source_biases = [(r[0], r[1]) for r in src_rows]
                ex_rows = conn.execute(
                    "SELECT s.name, nc.title, nc.body FROM news_cards nc "
                    "JOIN sources s ON s.id = nc.source_id "
                    "WHERE nc.cluster_id = ? LIMIT 5",
                    (cluster_id,),
                ).fetchall()
                excerpts = [(r[0], r[1], r[2] or "") for r in ex_rows]

            narrative = narrative_svc.generate_for_cluster(
                cluster_id, source_biases, excerpts
            )
            with get_db_connection(self.db_path) as conn:
                conn.execute(
                    "UPDATE clusters SET bias_narrative = ?, bias_key_quotes = ?, "
                    "bias_narrative_at = datetime('now'), bias_narrative_model = ? "
                    "WHERE id = ?",
                    (
                        narrative["narrative"],
                        json.dumps(narrative["key_quotes"], ensure_ascii=False),
                        narrative.get("source", "unknown"),
                        cluster_id,
                    ),
                )
                conn.commit()
        except Exception as e:
            logger.warning(f"Bias narrative generation skipped for {cluster_id}: {e}")

        # Generate contradiction report (numerical/factual disagreements
        # between sources in this cluster). Wrapped in try/except so a
        # detector bug never blocks the master article from being saved.
        try:
            from core.contradiction_detector import find_contradictions

            # Build article-shaped dicts for the detector. We use the
            # same articles that fed the synthesis so the contradictions
            # match what the user sees in the bias narrative.
            detector_articles = [
                {
                    "source": _primary_source_name(self.db_path, a.get("source_ids")),
                    "title": a.get("title") or "",
                    "summary": a.get("summary") or "",
                }
                for a in articles
            ]
            contradictions = find_contradictions(detector_articles)
            contradictions_payload = [c.to_dict() for c in contradictions]
            with get_db_connection(self.db_path) as conn:
                conn.execute(
                    "UPDATE clusters SET contradictions_json = ?, "
                    "contradictions_at = datetime('now'), contradictions_count = ? "
                    "WHERE id = ?",
                    (
                        json.dumps(contradictions_payload, ensure_ascii=False),
                        len(contradictions_payload),
                        cluster_id,
                    ),
                )
                conn.commit()
            if contradictions_payload:
                logger.info(
                    f"contradictions_found cluster={cluster_id} "
                    f"count={len(contradictions_payload)}"
                )
        except Exception as e:
            logger.warning(f"Contradiction detection skipped for {cluster_id}: {e}")

        return master_id

    def batch_synthesize(
        self, cluster_ids: Optional[List[str]] = None, limit: int = 100
    ) -> Dict:
        """Synthesize multiple clusters in batch."""
        with get_db_connection(self.db_path) as conn:
            if cluster_ids:
                placeholders = ",".join("?" for _ in cluster_ids)
                rows = conn.execute(
                    f"""
                    SELECT DISTINCT cluster_id FROM news_cards
                    WHERE cluster_id IS NOT NULL AND cluster_id != ''
                    AND cluster_id IN ({placeholders})
                    AND cluster_id NOT IN (SELECT cluster_id FROM master_articles)
                """,
                    cluster_ids,
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT DISTINCT cluster_id FROM news_cards
                    WHERE cluster_id IS NOT NULL AND cluster_id != ''
                    AND cluster_id NOT IN (SELECT cluster_id FROM master_articles)
                    ORDER BY (SELECT COUNT(*) FROM news_cards nc2 WHERE nc2.cluster_id = news_cards.cluster_id) DESC
                    LIMIT ?
                """,
                    (limit,),
                ).fetchall()

        cluster_ids_to_process = [r[0] for r in rows]
        total = len(cluster_ids_to_process)

        logger.info(f"batch_synthesis_start total={total}")

        results = {"total": total, "success": 0, "failed": 0, "skipped": 0}

        for i, cid in enumerate(cluster_ids_to_process):
            try:
                result = self.synthesize_cluster(cid)
                if result:
                    results["success"] += 1
                else:
                    results["skipped"] += 1

                if (i + 1) % 10 == 0:
                    logger.info(
                        f"batch_synthesis_progress {i + 1}/{total} success={results['success']}"
                    )
            except Exception as e:
                results["failed"] += 1
                logger.error(f"batch_synthesis_failed cluster={cid} error={e}")

        logger.info(
            f"batch_synthesis_complete total={total} "
            f"success={results['success']} failed={results['failed']} skipped={results['skipped']}"
        )

        return results
