import asyncio
import os
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.db.models import (
    Console,
    SegmentKind,
    SessionKind,
    SessionStatus,
    Tariff,
    TariffKind,
    Zone,
)
from core.services.business_days import open_business_day
from core.services.errors import ConflictError, NotFoundError, ValidationError
from core.services.sessions import start_session
from core.services.settings import DEFAULT_GRACE_MINUTES

T = datetime(2026, 9, 23, 12, 0, 0, tzinfo=UTC)

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test"
)


async def _setup(db_session, *, open_day: bool = True):
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    console = Console(zone_id=zone.id, name="PS5-1")
    db_session.add(console)
    package = Tariff(
        zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150
    )
    open_tariff = Tariff(
        zone_id=zone.id, kind=TariffKind.open, name="Открытое время", hourly_rate=120
    )
    db_session.add_all([package, open_tariff])
    await db_session.flush()
    if open_day:
        await open_business_day(db_session, opening_cash=5000, now=T)
    await db_session.commit()
    return console.id, package.id, open_tariff.id


@pytest.mark.asyncio
async def test_start_paid_package_session_shifts_end_by_grace(db_session):
    console_id, package_id, _ = await _setup(db_session)

    session = await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.paid,
        tariff_id=package_id,
        reason=None,
        comment=None,
        now=T,
    )

    assert session.status == SessionStatus.active
    assert session.grace_until == T + timedelta(minutes=DEFAULT_GRACE_MINUTES)
    assert len(session.segments) == 1
    segment = session.segments[0]
    assert segment.kind == SegmentKind.package
    assert segment.price_snapshot == 150
    assert segment.amount == 150
    assert segment.starts_at == T + timedelta(minutes=DEFAULT_GRACE_MINUTES)
    assert segment.ends_at == T + timedelta(minutes=DEFAULT_GRACE_MINUTES) + timedelta(minutes=60)


@pytest.mark.asyncio
async def test_start_open_session_billing_starts_after_grace(db_session):
    console_id, _, open_id = await _setup(db_session)

    session = await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.paid,
        tariff_id=open_id,
        reason=None,
        comment=None,
        now=T,
    )

    segment = session.segments[0]
    assert segment.kind == SegmentKind.open
    assert segment.ends_at is None
    assert segment.amount is None
    assert segment.price_snapshot == 120
    assert segment.starts_at == T + timedelta(minutes=DEFAULT_GRACE_MINUTES)


@pytest.mark.asyncio
async def test_start_free_session_requires_a_reason(db_session):
    console_id, package_id, _ = await _setup(db_session)

    with pytest.raises(ValidationError):
        await start_session(
            db_session,
            console_id=console_id,
            kind=SessionKind.free,
            tariff_id=None,
            reason=None,
            comment=None,
            now=T,
        )


@pytest.mark.asyncio
async def test_start_free_session_writes_an_audit_log_entry(db_session):
    from sqlalchemy import select

    from core.db.models import AuditLog

    console_id, _, _ = await _setup(db_session)

    session = await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.free,
        tariff_id=None,
        reason="друг владельца",
        comment=None,
        now=T,
    )

    result = await db_session.execute(select(AuditLog).where(AuditLog.entity_id == session.id))
    entries = result.scalars().all()
    assert len(entries) == 1
    assert entries[0].action == "free_session_start"
    assert entries[0].details["reason"] == "друг владельца"


@pytest.mark.asyncio
async def test_start_session_on_occupied_console_is_a_conflict(db_session):
    console_id, package_id, _ = await _setup(db_session)
    await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.paid,
        tariff_id=package_id,
        reason=None,
        comment=None,
        now=T,
    )

    with pytest.raises(ConflictError):
        await start_session(
            db_session,
            console_id=console_id,
            kind=SessionKind.paid,
            tariff_id=package_id,
            reason=None,
            comment=None,
            now=T,
        )


@pytest.mark.asyncio
async def test_start_session_without_an_open_business_day_is_a_conflict(db_session):
    console_id, package_id, _ = await _setup(db_session, open_day=False)

    with pytest.raises(ConflictError):
        await start_session(
            db_session,
            console_id=console_id,
            kind=SessionKind.paid,
            tariff_id=package_id,
            reason=None,
            comment=None,
            now=T,
        )


@pytest.mark.asyncio
async def test_start_session_with_unknown_tariff_is_not_found(db_session):
    console_id, _, _ = await _setup(db_session)

    with pytest.raises(NotFoundError):
        await start_session(
            db_session,
            console_id=console_id,
            kind=SessionKind.paid,
            tariff_id=999,
            reason=None,
            comment=None,
            now=T,
        )


@pytest.mark.asyncio
async def test_concurrent_starts_on_the_same_console_only_one_succeeds(db_session):
    console_id, package_id, _ = await _setup(db_session)

    engine2 = create_async_engine(TEST_DATABASE_URL)
    session_factory2 = async_sessionmaker(engine2, expire_on_commit=False)
    async with session_factory2() as db_session2:
        results = await asyncio.gather(
            start_session(
                db_session,
                console_id=console_id,
                kind=SessionKind.paid,
                tariff_id=package_id,
                reason=None,
                comment=None,
                now=T,
            ),
            start_session(
                db_session2,
                console_id=console_id,
                kind=SessionKind.paid,
                tariff_id=package_id,
                reason=None,
                comment=None,
                now=T,
            ),
            return_exceptions=True,
        )
    await engine2.dispose()

    successes = [r for r in results if not isinstance(r, BaseException)]
    failures = [r for r in results if isinstance(r, BaseException)]
    assert len(successes) == 1
    assert len(failures) == 1
    assert isinstance(failures[0], ConflictError)
