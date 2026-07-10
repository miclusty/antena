"""64-bit SimHash for near-duplicate detection in news cards.

SimHash produces a single 64-bit integer per document such that
documents with small Hamming distance are likely near-duplicates
(same event reported with slightly different wording).

Algorithm:
1. Normalize text (lowercase, strip accents via NFKD, drop punctuation)
2. Tokenize into words (>= 3 chars) and bigrams (pairs of adjacent words)
3. Hash each token using SHA-1 (we use only the first 8 bytes = 64 bits)
4. Weighted sum: each token's bits contribute to a signed accumulator
5. Final hash: each bit is 1 if accumulator > 0, else 0

Hamming distance <= 5 bits ~= duplicate probable.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from typing import Iterable, Tuple


_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _normalize(text: str) -> str:
    """Lowercase, strip accents, collapse whitespace."""
    if not text:
        return ""
    # NFKD decomposes accented chars; combining marks are stripped
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return text.lower()


def _tokens(text: str) -> list[str]:
    """Word tokens (>= 3 chars) + bigrams (pairs of adjacent tokens)."""
    norm = _normalize(text)
    words = [w for w in _TOKEN_RE.findall(norm) if len(w) >= 3]
    if len(words) < 2:
        return words
    bigrams = [f"{a}_{b}" for a, b in zip(words, words[1:])]
    return words + bigrams


def compute_simhash(text: str) -> int:
    """Compute a 64-bit SimHash for the given text. Returns int in [0, 2^64)."""
    if not text:
        return 0
    accum = [0] * 64
    tokens = _tokens(text)
    if not tokens:
        return 0
    for token in tokens:
        # SHA-1 -> first 8 bytes = 64 bits
        digest = hashlib.sha1(token.encode("utf-8")).digest()
        for bit_pos in range(64):
            byte_idx = bit_pos // 8
            bit_in_byte = bit_pos % 8
            bit_set = (digest[byte_idx] >> (7 - bit_in_byte)) & 1
            accum[bit_pos] += 1 if bit_set else -1
    result = 0
    for bit_pos in range(64):
        if accum[bit_pos] > 0:
            result |= 1 << bit_pos
    return result


def hamming_distance(a: int, b: int) -> int:
    """Count bits that differ between two 64-bit integers."""
    return bin(a ^ b).count("1")


def is_near_duplicate(a: int, b: int, threshold: int = 5) -> bool:
    """True if hamming_distance(a, b) <= threshold."""
    return hamming_distance(a, b) <= threshold


def find_near_duplicates(
    target: int,
    candidates: Iterable[Tuple[int, str]],
    threshold: int = 5,
) -> list[str]:
    """Filter candidate (hash, id) pairs to those within threshold of target."""
    return [
        cid for ch, cid in candidates
        if is_near_duplicate(target, ch, threshold)
    ]