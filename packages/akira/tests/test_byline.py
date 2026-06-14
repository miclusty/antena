"""Tests for extract_byline — ensures the byline regex
extraction rejects obvious non-authors and clamps to
MAX_AUTHOR_LEN. Kept separate from the extractor cascade
tests because this helper is called from the harvest
pipeline directly (not through the Extractor classes).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extractors.base import extract_byline, MAX_AUTHOR_LEN  # noqa: E402


def test_meta_name_author():
    html = '<meta name="author" content="Jane Doe">'
    assert extract_byline(html) == "Jane Doe"


def test_ogp_article_author():
    html = '<meta property="article:author" content="Juan Pérez">'
    assert extract_byline(html) == "Juan Pérez"


def test_dc_creator():
    html = '<meta name="DC.creator" content="ACME News">'
    assert extract_byline(html) == "ACME News"


def test_rejects_site_name():
    html = '<meta name="author" content="Home">'
    assert extract_byline(html) == ""


def test_rejects_staff():
    html = '<meta name="author" content="Staff">'
    assert extract_byline(html) == ""


def test_rejects_short_strings():
    html = '<meta name="author" content="AB">'
    assert extract_byline(html) == ""


def test_rejects_empty_html():
    assert extract_byline("") == ""


def test_clamps_to_max_author_len():
    long_name = "A" * (MAX_AUTHOR_LEN + 50)
    html = f'<meta name="author" content="{long_name}">'
    result = extract_byline(html)
    assert len(result) <= MAX_AUTHOR_LEN


def test_returns_empty_when_nothing_matches():
    assert extract_byline("<html><body>No byline here</body></html>") == ""


def test_whitespace_stripped():
    html = '<meta name="author" content="  Jane Doe  ">'
    assert extract_byline(html) == "Jane Doe"
