"""Tests for the unified LLMClient.

We don't make real network calls — these tests mock urllib.request so the
provider routing logic is exercised without hitting LM Studio or MiniMax.
"""
from unittest.mock import patch, MagicMock
import json

import pytest

from core.llm_client import LLMClient, LLMError


def test_default_provider_is_lmstudio(monkeypatch):
    """When no AKIRA_USE_MINIMAX env var, default provider is 'lmstudio'."""
    monkeypatch.delenv("AKIRA_USE_MINIMAX", raising=False)
    client = LLMClient()
    assert client.provider == "lmstudio"
    assert client.chat_model  # set by LMStudioClient


def test_explicit_lmstudio(monkeypatch):
    monkeypatch.delenv("AKIRA_USE_MINIMAX", raising=False)
    client = LLMClient(provider="lmstudio")
    assert client.provider == "lmstudio"


def test_explicit_minimax(monkeypatch):
    monkeypatch.delenv("AKIRA_USE_MINIMAX", raising=False)
    client = LLMClient(provider="minimax", minimax_api_key="test-key")
    assert client.provider == "minimax"
    assert client.api_key == "test-key"
    assert client.chat_model == "MiniMax-M2.7"


def test_env_var_triggers_minimax(monkeypatch):
    monkeypatch.setenv("AKIRA_USE_MINIMAX", "1")
    monkeypatch.setenv("MINIMAX_API_KEY", "env-key")
    client = LLMClient()
    assert client.provider == "minimax"
    assert client.api_key == "env-key"


def test_minimax_requires_api_key(monkeypatch):
    monkeypatch.delenv("MINIMAX_API_KEY", raising=False)
    with pytest.raises(ValueError, match="api_key"):
        LLMClient(provider="minimax")


def test_unknown_provider_raises():
    with pytest.raises(ValueError, match="unknown LLM provider"):
        LLMClient(provider="openai")


def test_lmstudio_chat_delegates(monkeypatch):
    """LLMClient.chat with provider='lmstudio' delegates to LMStudioClient."""
    monkeypatch.delenv("AKIRA_USE_MINIMAX", raising=False)
    client = LLMClient(provider="lmstudio")
    with patch.object(
        client._impl, "chat", return_value="hello back"
    ) as mock_chat:
        result = client.chat([{"role": "user", "content": "hi"}])
    assert result == "hello back"
    mock_chat.assert_called_once()


def test_minimax_chat_success(monkeypatch):
    """LLMClient.chat with provider='minimax' POSTs and parses response."""
    monkeypatch.setenv("MINIMAX_API_KEY", "test-key")
    client = LLMClient(provider="minimax")

    fake_resp = MagicMock()
    fake_resp.read.return_value = b'{"choices": [{"message": {"content": "ok"}}]}'
    fake_resp.__enter__ = MagicMock(return_value=fake_resp)
    fake_resp.__exit__ = MagicMock(return_value=False)

    with patch("urllib.request.urlopen", return_value=fake_resp) as mock_urlopen:
        result = client.chat([{"role": "user", "content": "hi"}])

    assert result == "ok"
    mock_urlopen.assert_called_once()
    # Verify the request URL
    request_arg = mock_urlopen.call_args[0][0]
    assert "chatcompletion_v2" in request_arg.full_url


def test_minimax_chat_raises_on_network_error(monkeypatch):
    import urllib.error

    monkeypatch.setenv("MINIMAX_API_KEY", "test-key")
    client = LLMClient(provider="minimax")

    with patch(
        "urllib.request.urlopen",
        side_effect=urllib.error.URLError("connection refused"),
    ):
        with pytest.raises(LLMError, match="minimax chat failed"):
            client.chat([{"role": "user", "content": "hi"}])


def test_minimax_embed_success(monkeypatch):
    monkeypatch.setenv("MINIMAX_API_KEY", "test-key")
    client = LLMClient(provider="minimax", embed_model="text-embedding-3-small")

    fake_resp = MagicMock()
    fake_resp.read.return_value = b'{"data": [{"embedding": [0.1, 0.2, 0.3]}]}'
    fake_resp.__enter__ = MagicMock(return_value=fake_resp)
    fake_resp.__exit__ = MagicMock(return_value=False)

    with patch("urllib.request.urlopen", return_value=fake_resp):
        vec = client.embed("hello")

    assert vec == [0.1, 0.2, 0.3]


def test_minimax_embed_override_model(monkeypatch):
    monkeypatch.setenv("MINIMAX_API_KEY", "test-key")
    client = LLMClient(provider="minimax")

    fake_resp = MagicMock()
    fake_resp.read.return_value = b'{"data": [{"embedding": [0.0]}]}'
    fake_resp.__enter__ = MagicMock(return_value=fake_resp)
    fake_resp.__exit__ = MagicMock(return_value=False)

    with patch("urllib.request.urlopen", return_value=fake_resp) as mock:
        client.embed("x", model="custom-model")

    request_arg = mock.call_args[0][0]
    body = json.loads(request_arg.data.decode())
    assert body["model"] == "custom-model"
