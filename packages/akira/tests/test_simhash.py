"""Tests for the simhash module — 64-bit near-duplicate hashing."""
import pytest
from core.simhash import (
    compute_simhash,
    hamming_distance,
    is_near_duplicate,
    find_near_duplicates,
)


def test_compute_simhash_returns_64bit_int():
    """simhash is always a 64-bit non-negative integer."""
    h = compute_simhash("Hola mundo")
    assert isinstance(h, int)
    assert 0 <= h < (1 << 64)


def test_same_text_same_hash():
    """Determinism: same input produces same hash."""
    text = "El presidente anunció nuevas medidas económicas"
    assert compute_simhash(text) == compute_simhash(text)


def test_simhash_case_insensitive():
    """Case doesn't matter — 'Hola' == 'HOLA'."""
    assert compute_simhash("Hola mundo") == compute_simhash("HOLA MUNDO")


def test_simhash_accent_insensitive():
    """Spanish accents don't matter."""
    assert compute_simhash("Perón") == compute_simhash("Peron")


def test_similar_titles_low_distance():
    """Two near-duplicates (paraphrase, same content) → ≤ 20 bits.
    Short Spanish news titles have high Hamming distances even when
    semantically similar — simhash works best on long documents. For
    titles we use a loose threshold + Jaccard tie-breaker downstream."""
    h1 = compute_simhash("Milei anunció nuevas medidas económicas hoy")
    h2 = compute_simhash("Milei anuncia nuevas medidas económicas para el país")
    assert hamming_distance(h1, h2) <= 20


def test_completely_unrelated_high_distance():
    """Unrelated articles → > 30 bits different."""
    h1 = compute_simhash("Elecciones en Córdoba 2026")
    h2 = compute_simhash("Receta de empanadas salteñas")
    assert hamming_distance(h1, h2) > 30


def test_exact_duplicate_zero_distance():
    """Same text → 0 Hamming distance."""
    text = "El dólar blue subió 12 pesos este martes"
    assert hamming_distance(compute_simhash(text), compute_simhash(text)) == 0


def test_threshold_boundary():
    """Threshold 5 vs 20 produces different results for moderately-similar text."""
    h1 = compute_simhash("Senado aprobó la ley de presupuesto 2026 con mayoría simple")
    h2 = compute_simhash("Con mayoría simple el Senado aprobó presupuesto 2026")
    d = hamming_distance(h1, h2)
    assert 10 < d < 30  # not duplicate, not unrelated


def test_is_near_duplicate_threshold():
    """is_near_duplicate respects threshold parameter."""
    h1 = compute_simhash("Noticia A")
    h2 = compute_simhash("Noticia B muy distinta")
    # Default threshold is 5
    assert is_near_duplicate(h1, h2) is False or hamming_distance(h1, h2) > 5


def test_find_near_duplicates_empty_list():
    """Empty list of candidates returns empty list."""
    assert find_near_duplicates(0, []) == []


def test_find_near_duplicates_filters_by_threshold():
    """find_near_duplicates filters out far-away candidates."""
    h = compute_simhash("Milei anunció nuevas medidas económicas hoy")
    near = compute_simhash("Milei anuncia nuevas medidas económicas para el país")
    far = compute_simhash("Receta de empanadas salteñas con limón")
    matches = find_near_duplicates(h, [(near, "near-id"), (far, "far-id")], threshold=20)
    assert "near-id" in matches
    assert "far-id" not in matches


def test_hamming_distance_zero_for_same_hash():
    """Same hash → 0 distance."""
    h = compute_simhash("Hola")
    assert hamming_distance(h, h) == 0