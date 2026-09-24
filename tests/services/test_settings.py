import pytest

from core.db.models import Setting
from core.services.settings import (
    DEFAULT_GRACE_MINUTES,
    DEFAULT_PLANNED_CLOSE,
    DEFAULT_PLANNED_OPEN,
    DEFAULT_WARN_MINUTES,
    get_grace_minutes,
    get_planned_close,
    get_planned_open,
    get_warn_minutes,
)


@pytest.mark.asyncio
async def test_get_grace_minutes_falls_back_to_default_when_unset(db_session):
    assert await get_grace_minutes(db_session) == DEFAULT_GRACE_MINUTES


@pytest.mark.asyncio
async def test_get_grace_minutes_falls_back_to_default_on_a_non_numeric_value(db_session):
    db_session.add(Setting(key="grace_minutes", value="not-a-number"))
    await db_session.commit()

    assert await get_grace_minutes(db_session) == DEFAULT_GRACE_MINUTES


@pytest.mark.asyncio
async def test_get_grace_minutes_reads_a_valid_value(db_session):
    db_session.add(Setting(key="grace_minutes", value="7"))
    await db_session.commit()

    assert await get_grace_minutes(db_session) == 7


@pytest.mark.asyncio
async def test_get_warn_minutes_falls_back_to_default_on_a_non_numeric_value(db_session):
    db_session.add(Setting(key="warn_minutes", value="soon"))
    await db_session.commit()

    assert await get_warn_minutes(db_session) == DEFAULT_WARN_MINUTES


@pytest.mark.asyncio
async def test_get_grace_minutes_falls_back_to_default_on_a_negative_value(db_session):
    db_session.add(Setting(key="grace_minutes", value="-5"))
    await db_session.commit()

    assert await get_grace_minutes(db_session) == DEFAULT_GRACE_MINUTES


@pytest.mark.asyncio
async def test_get_grace_minutes_accepts_zero(db_session):
    db_session.add(Setting(key="grace_minutes", value="0"))
    await db_session.commit()

    assert await get_grace_minutes(db_session) == 0


@pytest.mark.asyncio
async def test_get_planned_open_falls_back_to_default_when_unset(db_session):
    assert await get_planned_open(db_session) == DEFAULT_PLANNED_OPEN


@pytest.mark.asyncio
async def test_get_planned_close_falls_back_to_default_when_unset(db_session):
    assert await get_planned_close(db_session) == DEFAULT_PLANNED_CLOSE


@pytest.mark.asyncio
async def test_get_planned_close_reads_and_normalizes_a_valid_value(db_session):
    db_session.add(Setting(key="planned_close", value="5:0"))
    await db_session.commit()

    assert await get_planned_close(db_session) == "05:00"


@pytest.mark.asyncio
async def test_get_planned_open_falls_back_to_default_on_garbage(db_session):
    db_session.add(Setting(key="planned_open", value="not-a-time"))
    await db_session.commit()

    assert await get_planned_open(db_session) == DEFAULT_PLANNED_OPEN


@pytest.mark.asyncio
async def test_get_planned_close_falls_back_to_default_on_an_out_of_range_hour(db_session):
    db_session.add(Setting(key="planned_close", value="25:00"))
    await db_session.commit()

    assert await get_planned_close(db_session) == DEFAULT_PLANNED_CLOSE
