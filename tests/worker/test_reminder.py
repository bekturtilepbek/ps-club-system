from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio

from core.db.models import Setting
from core.db.session import engine
from core.services.business_days import open_business_day
from core.worker.main import _check_unclosed_day_reminder_async

T = datetime(2026, 9, 25, 10, 0, tzinfo=UTC)


@pytest_asyncio.fixture(autouse=True)
async def _cleanup_engine():
    """Dispose of the global engine's connection pool after each test to prevent
    event loop lifecycle issues between tests."""
    yield
    await engine.dispose()


@pytest.mark.asyncio
async def test_sends_nothing_when_no_day_is_open(db_session, monkeypatch):
    sent = []

    async def fake_send_message(chat_id, text):
        sent.append((chat_id, text))

    monkeypatch.setattr("core.worker.main.telegram.send_message", fake_send_message)
    monkeypatch.setattr("core.worker.main._worker_now", lambda: T)

    await _check_unclosed_day_reminder_async()

    assert sent == []


@pytest.mark.asyncio
async def test_sends_the_reminder_and_records_it_once_past_the_threshold(db_session, monkeypatch):
    sent = []

    async def fake_send_message(chat_id, text):
        sent.append((chat_id, text))

    monkeypatch.setattr("core.worker.main.telegram.send_message", fake_send_message)
    db_session.add(Setting(key="owner_chat_id", value="777"))
    await db_session.commit()
    day = await open_business_day(db_session, opening_cash=5000, now=T)

    due_at = T + timedelta(hours=20)  # planned_close (+19h, 05:00 next day) + 60min default threshold
    monkeypatch.setattr("core.worker.main._worker_now", lambda: due_at)

    await _check_unclosed_day_reminder_async()

    assert len(sent) == 1
    assert sent[0][0] == 777
    assert "05:00" in sent[0][1]

    await db_session.refresh(day)
    assert day.last_reminder_at == due_at
