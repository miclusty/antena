"""
LLM-as-judge for AKIRA RAG synthesis evaluation.

Implements the design doc §4.6 idea (without the full 3-pass
self-consistency — that's a separate feature). For now this
is a SINGLE-judge call that rates the synthesized perspectives
on 4 dimensions:
  - faithfulness: 1-5 (does the article match the sources?)
  - source_coverage: 1-5 (are cluster sources cited?)
  - perspective_balance: 1-5 (3 perspectives distinct?)
  - unsupported_claims_count: int (how many unsupported)

The judge is the SAME model that generates the synthesis
(qwen3.5-4b local). Known bias (see design doc §10 R5).
Mitigation: we ask the judge to be strict and reference
specific card_ids in its reasoning.

This is a *measurement* tool, not a *production* feature.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional

from ..lmstudio import LMStudioClient, LMStudioError

logger = logging.getLogger("akira.eval.judge")

JUDGE_MODEL = "qwen3.5-4b"

JUDGE_SYSTEM = (
    "Sos un juez editorial estricto. Recibís un artículo master "
    "(3 perspectivas: neutral, pro_gov, anti_gov) y los chunks "
    "originales del cluster. Respondé ÚNICAMENTE con JSON válido, "
    "sin texto antes ni después. El JSON tiene estas claves:\n"
    "  - faithfulness: entero 1-5 (5 = todo respaldado, 1 = pura invención)\n"
    "  - source_coverage: entero 1-5 (5 = todas las fuentes citadas, "
    "1 = ninguna fuente citada)\n"
    "  - perspective_balance: entero 1-5 (5 = 3 perspectivas distintas "
    "y equilibradas, 1 = las 3 dicen lo mismo o falta alguna)\n"
    "  - unsupported_claims: lista de strings (citas textuales del "
    "artículo que NO aparecen en los chunks)\n"
    "  - reasoning: 2-3 oraciones justificando los scores\n"
    "Sé estricto. Si una afirmación no está respaldada por un chunk, "
    "marcá como unsupported. Si dos perspectives dicen lo mismo, "
    "bajá perspective_balance."
)

JUDGE_USER_TEMPLATE = """## ARTÍCULO MASTER (a evaluar):
{master_article}

## CHUNKS ORIGINALES (cluster de evidencia):
{cluster_chunks}

## INSTRUCCIÓN:
Evaluá el artículo master contra los chunks. Score 1-5 cada dimensión.
Respondé SOLO JSON válido. Sin ``` ni explicaciones."""


@dataclass
class Judgment:
    faithfulness: int
    source_coverage: int
    perspective_balance: int
    unsupported_claims: List[str]
    reasoning: str
    raw_response: str = ""
    parse_error: Optional[str] = None

    def composite(self) -> float:
        """Single 0-1 score for ranking. Faithfulness is the
        main signal (it's the one we most care about); the
        other two are secondary."""
        f = self.faithfulness / 5.0
        s = self.source_coverage / 5.0
        p = self.perspective_balance / 5.0
        return 0.5 * f + 0.3 * s + 0.2 * p


class SynthesisJudge:
    """LLM-as-judge using the same local model the synthesis
    engine uses. Single call per judgment, no self-consistency
    in v1 (that's for synthesis v2)."""

    def __init__(self, lm_client: Optional[LMStudioClient] = None):
        self.lm = lm_client or LMStudioClient()

    def judge(
        self,
        master_article: Dict,
        cluster_chunks: List[Dict],
    ) -> Judgment:
        """Rate a synthesized master article against its source
        cluster. Returns a Judgment object with 4 scores.

        cluster_chunks: list of {id, title, summary, source_id, source_name}
        """
        article_str = json.dumps(master_article, ensure_ascii=False, indent=2)[:6000]
        chunks_str = "\n".join(
            f"[card_id={c.get('id', '?')}] {c.get('title', '')}: "
            f"{(c.get('summary') or '')[:200]}"
            for c in cluster_chunks[:30]
        )
        user = JUDGE_USER_TEMPLATE.format(
            master_article=article_str,
            cluster_chunks=chunks_str,
        )
        try:
            raw = self.lm.chat(
                [
                    {"role": "system", "content": JUDGE_SYSTEM},
                    {"role": "user", "content": user},
                ],
                model=JUDGE_MODEL,
                max_tokens=800,
                temperature=0.1,
            )
        except LMStudioError as e:
            logger.error(f"judge_lm_failed: {e}")
            return Judgment(
                faithfulness=0,
                source_coverage=0,
                perspective_balance=0,
                unsupported_claims=[],
                reasoning=f"LLM call failed: {e}",
                parse_error=str(e),
            )
        parsed = self._parse(raw)
        if parsed is None:
            return Judgment(
                faithfulness=0,
                source_coverage=0,
                perspective_balance=0,
                unsupported_claims=[],
                reasoning="Parse error",
                raw_response=raw[:500],
                parse_error="json_parse_failed",
            )
        parsed["raw_response"] = raw[:500]
        return Judgment(**parsed)

    def _parse(self, raw: str) -> Optional[Dict]:
        """Tolerantly parse the judge's JSON. Strip fences, find
        the outermost {...}, validate the 4 expected keys."""
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
        # Validate and clamp
        try:
            f = int(data.get("faithfulness", 0))
            s = int(data.get("source_coverage", 0))
            p = int(data.get("perspective_balance", 0))
        except (TypeError, ValueError):
            return None
        return {
            "faithfulness": max(0, min(5, f)),
            "source_coverage": max(0, min(5, s)),
            "perspective_balance": max(0, min(5, p)),
            "unsupported_claims": list(data.get("unsupported_claims", []) or []),
            "reasoning": str(data.get("reasoning", "")),
        }
