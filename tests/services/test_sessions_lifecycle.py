from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from core.db.models import (
    AuditLog,
    Console,
    SegmentKind,
    SessionKind,
    SessionStatus,
    Tariff,
    TariffKind,
    Zone,
)
from core.services.business_days import open_business_day
from core.services.errors import ConflictError, ValidationError
from core.services.sessions import cancel_session, extend_session, start_session, stop_session

T = datetime(2026, 9, 23, 12, 0, 0, tzinfo=UTC)


async def _setup(db_session):
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
    await open_business_day(db_session, opening_cash=5000, now=T)
    await db_session.commit()
    return console.id, package.id, open_tariff.id


@pytest.mark.asyncio
async def test_extend_with_open_time_chains_at_running_packages_end(db_session):
    console_id, package_id, open_id = await _setup(db_session)
    session = await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.paid,
        tariff_id=package_id,
        reason=None,
        comment=None,
        now=T,
    )
    package_end = session.segments[0].ends_at  # T + 3min + 60min

    extended = await extend_session(
        db_session, session_id=session.id, tariff_id=open_id, now=T + timedelta(minutes=10)
    )

    assert len(extended.segments) == 2
    new_segment = extended.segments[1]
    assert new_segment.kind == SegmentKind.open
    assert new_segment.starts_at == package_end
    assert new_segment.ends_at is None
    # the old package segment is untouched
    assert extended.segments[0].ends_at == package_end
    assert extended.segments[0].amount == 150


@pytest.mark.asyncio
async def test_extend_non_paid_session_is_a_validation_error(db_session):
    console_id, _, open_id = await _setup(db_session)
    session = await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.free,
        tariff_id=None,
        reason="друг",
        comment=None,
        now=T,
    )

    with pytest.raises(ValidationError):
        await extend_session(db_session, session_id=session.id, tariff_id=open_id, now=T)


@pytest.mark.asyncio
async def test_stop_closes_a_running_open_segment_and_computes_its_amount(db_session):
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
    billing_start = session.segments[0].starts_at  # T + 3min

    stopped = await stop_session(
        db_session, session_id=session.id, now=billing_start + timedelta(minutes=30)
    )

    assert stopped.status == SessionStatus.finished
    segment = stopped.segments[0]
    assert segment.ends_at == billing_start + timedelta(minutes=30)
    assert segment.amount == 60  # 30 minutes at 120 som/hour


@pytest.mark.asyncio
async def test_early_stop_of_a_running_package_writes_an_audit_log_entry(db_session):
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

    await stop_session(db_session, session_id=session.id, now=T + timedelta(minutes=10))

    entries = (
        (await db_session.execute(select(AuditLog).where(AuditLog.entity_id == session.id)))
        .scalars()
        .all()
    )
    assert len(entries) == 1
    assert entries[0].action == "early_stop"


@pytest.mark.asyncio
async def test_stop_after_package_naturally_ended_writes_no_audit_entry(db_session):
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
    package_end = session.segments[0].ends_at

    await stop_session(db_session, session_id=session.id, now=package_end + timedelta(minutes=1))

    entries = (
        (await db_session.execute(select(AuditLog).where(AuditLog.entity_id == session.id)))
        .scalars()
        .all()
    )
    assert len(entries) == 0


@pytest.mark.asyncio
async def test_cancel_within_grace_zeroes_the_segment_and_logs_it(db_session):
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

    cancelled = await cancel_session(
        db_session, session_id=session.id, now=T + timedelta(minutes=2)
    )

    assert cancelled.status == SessionStatus.cancelled
    assert cancelled.segments[0].amount == 0
    entries = (
        (await db_session.execute(select(AuditLog).where(AuditLog.entity_id == session.id)))
        .scalars()
        .all()
    )
    assert any(e.action == "cancel" for e in entries)


@pytest.mark.asyncio
async def test_cancel_after_grace_window_is_a_conflict(db_session):
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

    with pytest.raises(ConflictError):
        await cancel_session(db_session, session_id=session.id, now=T + timedelta(minutes=10))
