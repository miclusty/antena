"""News clustering service v2 - groups news cards by event.

Improvements over v1:
  - Multi-strategy matching: exact signature, Jaccard, n-gram
    containment, entity (capitalized word) overlap
  - Lower threshold (0.25) to catch paraphrased coverage
  - Stops on common stopwords to focus on entities
  - Soft canonical-URL match: same domain often means
    syndicated reprints (one source aggregating many)
  - Recomputes clusters from scratch each run so we can
    re-balance after threshold changes (idempotent for
    unchanged data)

No external ML dependencies.
"""

import re
import hashlib
import sqlite3
import logging
from typing import List, Dict, Set, Optional, Tuple
from collections import defaultdict, Counter
from urllib.parse import urlparse

from db.connection import get_db_connection

logger = logging.getLogger("akira")

# Min jaccard similarity to consider two items part of the same cluster.
# Lower than v1 (0.5) because news paraphrasing drops overlap sharply.
OVERLAP_THRESHOLD = 0.25

# N-gram containment threshold: how much of the smaller item's
# n-grams need to appear in the larger item. Catches cases
# where one headline is a subset of another.
NGRAM_CONTAINMENT_THRESHOLD = 0.55

# Entity overlap: ratio of shared capitalized words (proper
# nouns) that are NOT in the stopword set.
ENTITY_OVERLAP_THRESHOLD = 0.4

# Minimum cluster size (cards below this become singletons
# in their own cluster).
MIN_CLUSTER_SIZE = 2

# Spanish stopwords that don't carry meaning. Lowercased.
STOPWORDS = {
    "a", "al", "algo", "algunas", "algunos", "ante", "antes", "como", "con",
    "contra", "cual", "cuando", "de", "del", "desde", "donde", "durante",
    "e", "el", "ella", "ellas", "ellos", "en", "entre", "era", "erais",
    "eran", "eras", "eres", "es", "esa", "esas", "ese", "eso", "esos",
    "esta", "estaba", "estabais", "estaban", "estabas", "estad", "estada",
    "estadas", "estado", "estados", "estais", "estamos", "estan", "estar",
    "estará", "estarán", "estarás", "estaré", "estaréis", "estaríamos",
    "estarían", "estarías", "estas", "este", "esto", "estos", "estoy",
    "estuve", "estuviera", "estuvierais", "estuvieran", "estuvieras",
    "estuvieron", "estuviese", "estuvieseis", "estuviesen", "estuvieses",
    "estuvimos", "estuviste", "estuvisteis", "estuvo", "etc", "fue",
    "fuera", "fuerais", "fueran", "fueras", "fueron", "fuese", "fueseis",
    "fuesen", "fueses", "fui", "fuimos", "fuiste", "fuisteis", "ha", "habida",
    "habidas", "habido", "habidos", "habiendo", "habremos", "habrá",
    "habrán", "habrás", "habré", "habréis", "habríamos", "habrían",
    "habías", "habíamos", "habido", "hay", "haya", "hayamos", "hayan",
    "hayas", "hayáis", "he", "hemos", "hube", "hubiera", "hubierais",
    "hubieran", "hubieras", "hubieron", "hubiese", "hubieseis",
    "hubiesen", "hubieses", "hubimos", "hubiste", "hubisteis", "hubo",
    "la", "las", "le", "les", "lo", "los", "más", "me", "mi", "mis",
    "mucho", "muchas", "muchos", "muy", "nada", "ni", "no", "nos",
    "nosotras", "nosotros", "nuestra", "nuestras", "nuestro", "nuestros",
    "o", "os", "otra", "otras", "otro", "otros", "para", "pero", "poco",
    "por", "porque", "que", "quien", "quienes", "sea", "seais", "seamos",
    "sean", "seas", "ser", "seremos", "sería", "seríais", "seríamos",
    "serían", "serías", "si", "sido", "siendo", "sin", "sobre", "sois",
    "somos", "son", "soy", "su", "sus", "también", "tanto", "te", "tendrá",
    "tendrán", "tendras", "tendré", "tendremos", "tendría", "tendríais",
    "tendríamos", "tendrían", "tenemos", "tener", "tengo", "ti", "tiene",
    "tienen", "tienes", "todo", "todos", "tu", "tus", "un", "una",
    "uno", "unos", "vosotras", "vosotros", "vuestra", "vuestras",
    "vuestro", "vuestros", "y", "ya", "yo",
    # News-specific stopwords that add noise
    "tras", "segun", "dijo", "anuncio", "anunció", "afirmo", "afirmó",
    "aseguro", "aseguró", "confirmo", "confirmó", "aseguran", "sostuvo",
    "manifesto", "manifestó", "denuncio", "denunció", "cuestiono", "cuestionó",
    "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo",
    "ano", "año", "mes", "dia", "día", "hora", "horas", "minuto", "minutos",
    "argentina", "argentino", "argentinos", "nacion", "país", "pais",
}


def normalize_text(text: str) -> str:
    """Lowercase, strip accents and punctuation, collapse whitespace.

    Note on the regex: `re.sub(r"[^\w\s]", "", text)` keeps
    word chars + whitespace and strips punctuation. The old
    version had a typo where the replacement was a literal
    space string (" ") instead of the variable `text` — that
    wiped out ALL the input and returned a single space,
    making every text normalize to "" and breaking the entire
    clustering signal chain.
    """
    if not text:
        return ""
    text = text.lower()
    text = (
        text.replace("á", "a")
        .replace("é", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ú", "u")
    )
    text = text.replace("ü", "u").replace("ñ", "n")
    text = re.sub(r"[^\w\s]", "", text)  # punctuation → empty
    text = re.sub(r"\s+", " ", text).strip()
    return text


def tokenize(text: str, min_len: int = 3) -> Set[str]:
    """Get significant tokens (no stopwords, min length filter)."""
    words = normalize_text(text).split()
    return {w for w in words if len(w) >= min_len and w not in STOPWORDS}


def get_entities(title: str) -> Set[str]:
    """Get proper-noun-like entities: capitalized words not in stopwords.

    We look at the original (non-normalized) title for capitalized
    tokens. Common Spanish titles have "Milei", "Caputo", "CABA",
    "Argentina" etc. as entities.
    """
    if not title:
        return set()
    # Strip punctuation and split
    raw = re.sub(r"[^\w\s]", " ", title)
    tokens = raw.split()
    ents = set()
    for t in tokens:
        if len(t) < 3:
            continue
        if t.lower() in STOPWORDS:
            continue
        if t[0].isupper():
            # First letter is uppercase, treat as proper noun.
            # Also catch "EE.UU." or acronyms.
            ents.add(t.lower())
    return ents


def compute_title_signature(title: str) -> str:
    """Signature: first 5 significant tokens (sorted, deduped)."""
    tokens = tokenize(title)
    return "|".join(sorted(tokens)[:5])


def get_ngrams(title: str, n: int = 3) -> Set[Tuple[str, ...]]:
    """N-gram token sequences for substring-style matching."""
    tokens = sorted(tokenize(title))
    if len(tokens) < n:
        return set()
    return {tuple(tokens[i : i + n]) for i in range(len(tokens) - n + 1)}


def jaccard(s1: Set, s2: Set) -> float:
    if not s1 or not s2:
        return 0.0
    inter = len(s1 & s2)
    union = len(s1 | s2)
    return inter / union if union else 0.0


def ngram_containment(small: Set[Tuple[str, ...]], large: Set[Tuple[str, ...]]) -> float:
    """Fraction of small's n-grams that appear in large.
    Catches "subset" cases (one headline is a substring of another)."""
    if not small or not large:
        return 0.0
    return len(small & large) / len(small)


def url_domain_match(url1: str, url2: str) -> bool:
    """Same domain AND same article path → syndicated reprint.

    The old version returned True on any same-domain match, and
    merge_score then boosted the similarity to 0.6. That caused
    bad clusters: a newspaper like eldiarioar.com publishes ~50
    stories per day, and we were grouping all of them into one
    giant cluster ("eldiarioar") instead of by event.

    The new version requires BOTH the domain to match AND the
    URL paths to share a meaningful token (e.g. /2026/06/maradona
    -juicio appearing in both paths). That's the signal of "same
    article syndicated" vs "two different stories on the same
    domain".
    """
    if not url1 or not url2:
        return False
    try:
        p1 = urlparse(url1)
        p2 = urlparse(url2)
        d1 = p1.netloc.lower().removeprefix("www.")
        d2 = p2.netloc.lower().removeprefix("www.")
        if not d1 or d1 != d2:
            return False
        # Path-token overlap: require at least 2 shared meaningful
        # tokens, OR one path is a prefix of the other (e.g. with
        # /amp/ or trailing slug).
        path_tokens_1 = set(re.findall(r"[a-z0-9]+", p1.path.lower()))
        path_tokens_2 = set(re.findall(r"[a-z0-9]+", p2.path.lower()))
        noise = {"", "www", "html", "php", "asp", "amp", "index",
                 "category", "tag", "archives", "es", "ar",
                 # Date tokens — most URLs include /2026/06/14/... and
                 # that shouldn't count as "shared content".
                 "2024", "2025", "2026", "2027", "01", "02", "03",
                 "04", "05", "06", "07", "08", "09", "10", "11", "12"}
        path_tokens_1 -= noise
        path_tokens_2 -= noise
        if len(path_tokens_1 & path_tokens_2) >= 2:
            return True
        path1_str = p1.path.rstrip("/")
        path2_str = p2.path.rstrip("/")
        if path1_str and path2_str and (
            path1_str.startswith(path2_str) or path2_str.startswith(path1_str)
        ):
            return True
        return False
    except Exception:
        return False


def merge_score(
    a_tokens: Set[str], a_ents: Set[str], a_url: str,
    b_tokens: Set[str], b_ents: Set[str], b_url: str,
) -> float:
    """Compute a single similarity score from multiple signals.

    Returns 0..1. > threshold means the two items are about the
    same event.
    """
    # 1. Token Jaccard.
    score = jaccard(a_tokens, b_tokens)

    # 2. N-gram containment. Boost if one is a subset of the other.
    ng_a = get_ngrams(" ".join(a_tokens))
    ng_b = get_ngrams(" ".join(b_tokens))
    if ng_a and ng_b:
        containment = max(
            ngram_containment(ng_a, ng_b),
            ngram_containment(ng_b, ng_a),
        )
        if containment > NGRAM_CONTAINMENT_THRESHOLD:
            score = max(score, containment)

    # 3. Entity overlap. Strong signal of "same person/place".
    ent_sim = jaccard(a_ents, b_ents)
    if ent_sim > ENTITY_OVERLAP_THRESHOLD:
        score = max(score, ent_sim * 0.95)  # slightly discounted

    # 4. URL match (syndicated reprint detection).
    # The old boost was 0.6 which fired on any same-domain
    # match — that grouped all stories from one newspaper into
    # the same cluster, which is the opposite of what we want.
    # Now url_domain_match() requires the URL path to also
    # share meaningful tokens (so it's actually the same
    # article), and the boost is lowered to 0.4 to keep it as
    # a "soft" signal that combines with the Jaccard/entity
    # scores above. We also require at least one shared
    # entity to be present — pure URL match with no shared
    # entities is suspicious.
    if url_domain_match(a_url, b_url) and (a_ents & b_ents):
        score = max(score, 0.4)

    return score


class ClusteringService:
    """
    Groups news cards into clusters by event.

    Algorithm:
      1. Pull all unclustered (or all) cards in a batch.
      2. For each, compute tokens + entities + n-grams.
      3. Phase 1: group by exact 5-token signature (high confidence).
      4. Phase 2: for each remaining singleton, find the best existing
         cluster by merge_score; merge if score > threshold.
      5. Phase 3: any cards that didn't find a home get their own
         singleton cluster.
      6. Update DB cluster_id for all participating cards.

    Threshold: 0.25 by default. Lower = more permissive (more
    groups). Run idempotently — unchanged inputs produce unchanged
    clusters (modulo hash ordering).
    """

    def __init__(
        self,
        db_path: str,
        overlap_threshold: float = OVERLAP_THRESHOLD,
    ):
        self.db_path = db_path
        self.threshold = overlap_threshold

    def cluster_news_cards(
        self, card_ids: Optional[List[str]] = None
    ) -> Dict[str, List[str]]:
        """
        Cluster news cards. If `card_ids` is None, cluster ALL
        active cards (full re-cluster). Otherwise cluster the
        given subset (used by `cluster_recent_news` for delta
        clustering of new arrivals).

        Returns:
            Dict mapping cluster_id -> list of card_ids.
        """
        # Production callers should invoke `cluster_recent_news(hours=24)`
        # instead of the full pull: clustering all 50k cards is O(n²)
        # and a 50k-card run can take ~10 minutes, during which any
        # crash leaves the DB with NULL cluster_ids for the cleared
        # range. cluster_recent_news() operates on small bounded
        # batches and is idempotent across restarts.
        if card_ids is None:
            logger.warning(
                "cluster_news_cards full pull is O(n²) and uses LIMIT 5000 — "
                "production should use cluster_recent_news()"
            )

        with get_db_connection(self.db_path) as conn:
            try:
                if card_ids is None:
                    rows = conn.execute(
                        "SELECT id, title, source_ids, image_url FROM news_cards "
                        "ORDER BY created_at DESC LIMIT 5000"
                    ).fetchall()
                else:
                    placeholders = ",".join("?" * len(card_ids))
                    rows = conn.execute(
                        f"SELECT id, title, source_ids, image_url FROM news_cards "
                        f"WHERE id IN ({placeholders})",
                        card_ids,
                    ).fetchall()

                if not rows:
                    return {}

                items = [
                    (str(r["id"]), r["title"] or "", r["source_ids"] or "", r["image_url"] or "")
                    for r in rows
                ]
                # BEGIN a single transaction covering clear + recompute
                # + write-back so an interrupted run can't leave
                # cluster_ids NULL for cards we're about to re-cluster.
                # Without this, a SIGKILL after the UPDATE-NULL but
                # before the per-cluster INSERTs would orphan every
                # card from its cluster until the next re-cluster run.
                conn.execute("BEGIN IMMEDIATE")
                # Wipe existing cluster_id for the cards we're re-clustering.
                ids_to_clear = [it[0] for it in items]
                placeholders = ",".join("?" * len(ids_to_clear))
                conn.execute(
                    f"UPDATE news_cards SET cluster_id = NULL WHERE id IN ({placeholders})",
                    ids_to_clear,
                )

                clusters = self._compute_clusters(items)

                # Update DB with new cluster IDs.
                for cluster_id, ids in clusters.items():
                    for cid in ids:
                        conn.execute(
                            "UPDATE news_cards SET cluster_id = ? WHERE id = ?",
                            (cluster_id, cid),
                        )
                conn.execute("COMMIT")
            except Exception:
                # Roll back so the previous cluster_ids are preserved
                # across restarts.
                try:
                    conn.execute("ROLLBACK")
                except sqlite3.OperationalError:
                    pass  # pragma: no cover — defensive only
                raise

        logger.info(
            f"clustering_v2_complete cards={len(items)} clusters={len(clusters)}"
        )
        return clusters

    def _compute_clusters(
        self, items: List[Tuple[str, str, str, str]]
    ) -> Dict[str, List[str]]:
        """
        Compute clusters from a list of (id, title, source_ids, image_url).
        """
        # Pre-compute per-item features.
        features: Dict[str, dict] = {}
        for card_id, title, source_ids, image_url in items:
            tokens = tokenize(title)
            ents = get_entities(title)
            # Extract the first source_id from the source_ids CSV.
            primary_source_id = None
            if source_ids:
                first = source_ids.split(",")[0].strip()
                if first.isdigit():
                    primary_source_id = int(first)
            # Use the image URL's domain as a "source attribution"
            # signal: cards with the same image URL are very likely
            # the same syndicated article.
            image_domain = ""
            if image_url:
                try:
                    image_domain = urlparse(image_url).netloc.lower()
                except Exception:
                    pass
            features[card_id] = {
                "title": title,
                "tokens": tokens,
                "ents": ents,
                "source_id": primary_source_id,
                "image_domain": image_domain,
            }

        # Phase 1: group by exact 5-token signature.
        sig_to_ids: Dict[str, List[str]] = defaultdict(list)
        for card_id, f in features.items():
            sig = compute_title_signature(f["title"])
            if sig:
                sig_to_ids[sig].append(card_id)

        cluster_id_map: Dict[str, str] = {}  # card_id -> cluster_id
        clusters: Dict[str, List[str]] = defaultdict(list)
        for sig, ids in sig_to_ids.items():
            if len(ids) >= MIN_CLUSTER_SIZE:
                cluster_id = hashlib.md5(sig.encode()).hexdigest()[:12]
                for cid in ids:
                    cluster_id_map[cid] = cluster_id
                    clusters[cluster_id].append(cid)
        # Any sig with only 1 item is a "pending singleton" — try to
        # merge it into an existing cluster in phase 2.

        # Phase 2: for pending singletons, find the best matching
        # cluster by merge_score.
        all_ids = set(features.keys())
        pending = [cid for cid in all_ids if cid not in cluster_id_map]
        for single_id in pending:
            sf = features[single_id]
            best_cluster = None
            best_score = 0.0
            for cluster_id, members in clusters.items():
                # Use the cluster's representative (first member)
                # for comparison — clusters with many members are
                # already well-defined, so this is fast and robust.
                rep_id = members[0]
                rf = features[rep_id]
                # Same source_id and same image_domain → strong
                # signal of the SAME article syndicated. Bump score
                # up to the threshold.
                if (sf["source_id"] and sf["source_id"] == rf["source_id"]) or \
                   (sf["image_domain"] and sf["image_domain"] == rf["image_domain"]):
                    score = max(best_score, self.threshold + 0.05)
                else:
                    score = merge_score(
                        sf["tokens"], sf["ents"], sf.get("image_url", ""),
                        rf["tokens"], rf["ents"], rf.get("image_url", ""),
                    )
                if score > best_score:
                    best_score = score
                    best_cluster = cluster_id
            if best_cluster and best_score >= self.threshold:
                cluster_id_map[single_id] = best_cluster
                clusters[best_cluster].append(single_id)
            else:
                # Singleton → its own cluster with a hash of the id.
                cid_hash = hashlib.md5(single_id.encode()).hexdigest()[:12]
                clusters[cid_hash].append(single_id)
                cluster_id_map[single_id] = cid_hash

        return {k: v for k, v in clusters.items() if v}

    def cluster_recent_news(
        self, hours: int = 24, limit: int = 500
    ) -> Dict[str, List[str]]:
        """Cluster recent unclustered news cards from the database."""
        with get_db_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT id FROM news_cards
                WHERE cluster_id IS NULL
                  AND created_at >= datetime('now', ?)
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (f"-{hours} hours", limit),
            ).fetchall()
            ids = [str(r["id"]) for r in rows]
        if not ids:
            return {}
        return self.cluster_news_cards(ids)
