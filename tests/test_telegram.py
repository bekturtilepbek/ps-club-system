import logging

import pytest

from core import telegram
from core.config import settings


class _FakeBotSession:
    async def close(self) -> None:
        pass


class _FakeBot:
    sent: list[tuple[int, str]] = []

    def __init__(self, token: str) -> None:
        self.token = token
        self.session = _FakeBotSession()

    async def send_message(self, chat_id: int, text: str) -> None:
        _FakeBot.sent.append((chat_id, text))


@pytest.fixture(autouse=True)
def _reset_fake_bot():
    _FakeBot.sent = []
    yield


@pytest.mark.asyncio
async def test_send_message_calls_the_telegram_api_when_token_is_set(monkeypatch):
    monkeypatch.setattr(settings, "bot_token", "123:fake-token")
    monkeypatch.setattr(telegram, "Bot", _FakeBot)

    await telegram.send_message(555, "hello")

    assert _FakeBot.sent == [(555, "hello")]


@pytest.mark.asyncio
async def test_send_message_is_a_noop_when_token_is_not_set(monkeypatch, caplog):
    monkeypatch.setattr(settings, "bot_token", None)
    monkeypatch.setattr(telegram, "Bot", _FakeBot)

    with caplog.at_level(logging.WARNING):
        await telegram.send_message(555, "hello")

    assert _FakeBot.sent == []
    assert "BOT_TOKEN" in caplog.text
