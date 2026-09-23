from datetime import UTC, datetime, timedelta

import pytest

from core.db.models import (
    Console,
    Payment,
    PaymentMethod,
    Session,
    SessionKind,
    SessionStatus,
    Zone,
)
from core.services.business_days import close_business_day, get_open_business_day, open_business_day
from core.services.errors import ConflictError, NotFoundError

T = datetime(2026, 9, 23, 10, 0, 0, tzinfo=UTC)


async def _make_finished_session(db_session, business_day_id: int) -> int:
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    console = Console(zone_id=zone.id, name="PS5-1")
    db_session.add(console)
    await db_session.flush()
    session = Session(
        console_id=console.id,
        business_day_id=business_day_id,
        kind=SessionKind.paid,
        status=SessionStatus.finished,
        started_at=T,
        grace_until=T,
        ended_at=T,
    )
    db_session.add(session)
    await db_session.flush()
    return session.id


@pytest.mark.asyncio
async def test_open_business_day_sets_opening_cash(db_session):
    day = await open_business_day(db_session, opening_cash=5000, now=T)
    assert day.opening_cash == 5000
    assert day.closed_at is None
    assert await get_open_business_day(db_session) is not None


@pytest.mark.asyncio
async def test_cannot_open_a_second_business_day(db_session):
    await open_business_day(db_session, opening_cash=5000, now=T)
    with pytest.raises(ConflictError):
        await open_business_day(db_session, opening_cash=1000, now=T)


@pytest.mark.asyncio
async def test_close_business_day_computes_expected_cash_from_cash_payments_only(db_session):
    day = await open_business_day(db_session, opening_cash=5000, now=T)
    session_id = await _make_finished_session(db_session, day.id)
    db_session.add(
        Payment(
            session_id=session_id,
            business_day_id=day.id,
            amount=300,
            method=PaymentMethod.cash,
            created_at=T,
        )
    )
    db_session.add(
        Payment(
            session_id=session_id,
            business_day_id=day.id,
            amount=999,
            method=PaymentMethod.qr,
            created_at=T,
        )
    )
    await db_session.commit()

    closed = await close_business_day(
        db_session, business_day_id=day.id, counted_cash=5300, now=T + timedelta(hours=8)
    )
    assert closed.expected_cash == 5300  # 5000 opening + 300 cash, QR excluded
    assert closed.counted_cash == 5300
    assert closed.closed_at is not None


@pytest.mark.asyncio
async def test_close_unknown_business_day_raises_not_found(db_session):
    with pytest.raises(NotFoundError):
        await close_business_day(db_session, business_day_id=999, counted_cash=0, now=T)


@pytest.mark.asyncio
async def test_close_business_day_with_active_session_is_a_conflict(db_session):
    day = await open_business_day(db_session, opening_cash=5000, now=T)
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    console = Console(zone_id=zone.id, name="PS5-1")
    db_session.add(console)
    await db_session.flush()
    db_session.add(Session(
        console_id=console.id, business_day_id=day.id, kind=SessionKind.paid,
        status=SessionStatus.active, started_at=T, grace_until=T,
    ))
    await db_session.commit()

    with pytest.raises(ConflictError):
        await close_business_day(db_session, business_day_id=day.id, counted_cash=5000, now=T)
