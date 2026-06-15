import pytest
from extractors._slug import make_slug


class TestMakeSlug:
    def test_basic_ascii(self):
        assert make_slug("Hello World") == "hello-world"

    def test_removes_accents(self):
        assert make_slug("Dólar blue HOY") == "dolar-blue-hoy"

    def test_removes_stopwords(self):
        assert make_slug("El gobierno de Argentina anunció") == "gobierno-argentina-anuncio"

    def test_lowercases(self):
        assert make_slug("UPPERCASE") == "uppercase"

    def test_handles_punctuation(self):
        assert make_slug("Dólar blue HOY: cierre a $1.245") == "dolar-blue-hoy-cierre-1245"

    def test_handles_numbers(self):
        assert make_slug("2026 noticias") == "2026-noticias"

    def test_truncates_to_max_words(self):
        result = make_slug("alpha bravo charlie delta echo foxtrot golf", max_words=5)
        assert result == "alpha-bravo-charlie-delta-echo"

    def test_empty_title_returns_fallback(self):
        assert make_slug("") == "sin-titulo"
        assert make_slug("   ") == "sin-titulo"
        assert make_slug("!!!") == "sin-titulo"

    def test_only_stopwords_returns_fallback(self):
        assert make_slug("el la de los las") == "sin-titulo"

    def test_collapses_whitespace(self):
        assert make_slug("foo   bar   baz") == "foo-bar-baz"

    def test_unicode_handling(self):
        assert make_slug("Niño en Bogotá") == "nino-bogota"
        assert make_slug("São Paulo") == "sao-paulo"
