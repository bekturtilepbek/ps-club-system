import asyncio
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


class _HangingBot:
    """Never actually sleeps for the real timeout duration — it waits on an
    Event that the test never sets, so asyncio.wait_for's own cancellation is
    what ends the call. Exercises the wait_for path without a slow test."""

    def __init__(self, token: str) -> None:
        self.token = token
        self.session = _FakeBotSession()

    async def send_message(self, chat_id: int, text: str) -> None:
        await asyncio.Event().wait()


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


@pytest.mark.asyncio
async def test_send_message_times_out_instead_of_hanging_forever(monkeypatch):
    monkeypatch.setattr(settings, "bot_token", "123:fake-token")
    monkeypatch.setattr(telegram, "Bot", _HangingBot)
    # Keep the test itself fast — don't literally wait out the real 10s timeout.
    monkeypatch.setattr(telegram, "SEND_MESSAGE_TIMEOUT_SECONDS", 0.05)

    loop = asyncio.get_event_loop()
    started = loop.time()
    # The outer wait_for is only a safety net against this test itself hanging
    # forever if send_message regresses — the real assertion is the elapsed-time
    # check below, which fails fast (rather than eating the full 1s) whenever
    # send_message doesn't apply its own short internal timeout.
    with pytest.raises(TimeoutError):
        await asyncio.wait_for(telegram.send_message(555, "hello"), timeout=1.0)
    elapsed = loop.time() - started

    assert elapsed < 0.5
