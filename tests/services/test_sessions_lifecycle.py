from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from core.db.models import (
    AuditLog,
    Console,
    Product,
    SegmentKind,
    SessionKind,
    SessionStatus,
    Tariff,
    TariffKind,
    Zone,
)
from core.services.bar import add_order
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
async def test_stop_with_a_queued_open_segment_still_audits_the_early_package_stop(db_session):
    # Package running, extended to open time while the package still has time left,
    # then stopped before the package naturally ends. The queued open segment never
    # started accruing — but the early-stop audit for the PACKAGE must still fire.
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

    await extend_session(
        db_session, session_id=session.id, tariff_id=open_id, now=T + timedelta(minutes=10)
    )
    stopped = await stop_session(db_session, session_id=session.id, now=T + timedelta(minutes=15))

    # the package keeps its full price, untouched
    assert stopped.segments[0].ends_at == package_end
    assert stopped.segments[0].amount == 150
    # the queued open segment is clamped closed at its own start, not inverted
    open_segment = stopped.segments[1]
    assert open_segment.ends_at == open_segment.starts_at == package_end
    assert open_segment.amount == 0

    entries = (
        (await db_session.execute(select(AuditLog).where(AuditLog.entity_id == session.id)))
        .scalars()
        .all()
    )
    assert [e.action for e in entries] == ["early_stop"]


@pytest.mark.asyncio
async def test_extend_with_package_after_queuing_open_time_does_not_overlap_the_running_package(
    db_session,
):
    # The exact C1 scenario: package -> queue open time -> change mind, buy another
    # package. The second package must chain at the first package's end, not "now".
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

    await extend_session(
        db_session, session_id=session.id, tariff_id=open_id, now=T + timedelta(minutes=10)
    )
    extended_again = await extend_session(
        db_session, session_id=session.id, tariff_id=package_id, now=T + timedelta(minutes=15)
    )

    assert len(extended_again.segments) == 3
    queued_open, second_package = extended_again.segments[1], extended_again.segments[2]
    assert queued_open.kind == SegmentKind.open
    assert second_package.kind == SegmentKind.package
    # the queued open segment is clamped closed at its own start, not inverted
    assert queued_open.ends_at == queued_open.starts_at == package_end
    assert queued_open.amount == 0
    # the second package chains at the first package's end — no overlap, no double-bill
    assert second_package.starts_at == package_end
    assert second_package.ends_at == package_end + timedelta(minutes=60)


@pytest.mark.asyncio
async def test_third_extension_chains_after_the_second_package_not_the_clamped_open_segment(
    db_session,
):
    # After the C1 scenario the clamped open segment and the second package share the
    # same starts_at. A further extension must chain at the second package's end.
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
    package_end = session.segments[0].ends_at

    await extend_session(
        db_session, session_id=session.id, tariff_id=open_id, now=T + timedelta(minutes=10)
    )
    await extend_session(
        db_session, session_id=session.id, tariff_id=package_id, now=T + timedelta(minutes=15)
    )
    extended = await extend_session(
        db_session, session_id=session.id, tariff_id=package_id, now=T + timedelta(minutes=20)
    )

    assert len(extended.segments) == 4
    assert extended.segments[3].starts_at == package_end + timedelta(minutes=60)


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
        db_session, session_id=session.id, now=T + timedelta(seconds=30)
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
async def test_cancel_with_bar_items_is_a_conflict_and_changes_nothing(db_session):
    console_id, package_id, _ = await _setup(db_session)
    cola = Product(name="Кола", price=80, is_active=True)
    db_session.add(cola)
    await db_session.commit()
    session = await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.paid,
        tariff_id=package_id,
        reason=None,
        comment=None,
        now=T,
    )
    await add_order(
        db_session, session_id=session.id, product_id=cola.id, qty=1, now=T + timedelta(minutes=1)
    )

    with pytest.raises(ConflictError, match="bar items"):
        await cancel_session(db_session, session_id=session.id, now=T + timedelta(seconds=30))

    await db_session.refresh(session)
    assert session.status == SessionStatus.active
    assert session.segments[0].amount == 150
    entries = (
        (await db_session.execute(select(AuditLog).where(AuditLog.entity_id == session.id)))
        .scalars()
        .all()
    )
    assert not any(e.action == "cancel" for e in entries)


@pytest.mark.asyncio
async def test_cancel_after_removing_the_bar_item_is_allowed(db_session):
    from core.services.bar import remove_order

    console_id, package_id, _ = await _setup(db_session)
    cola = Product(name="Кола", price=80, is_active=True)
    db_session.add(cola)
    await db_session.commit()
    session = await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.paid,
        tariff_id=package_id,
        reason=None,
        comment=None,
        now=T,
    )
    order = await add_order(
        db_session, session_id=session.id, product_id=cola.id, qty=1, now=T + timedelta(minutes=1)
    )
    await remove_order(db_session, order_id=order.id, now=T + timedelta(minutes=1))

    cancelled = await cancel_session(
        db_session, session_id=session.id, now=T + timedelta(seconds=30)
    )

    assert cancelled.status == SessionStatus.cancelled


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


@pytest.mark.asyncio
async def test_cancel_after_a_payment_is_a_conflict_and_changes_nothing(db_session):
    """A prepayment stays in the till's cash/revenue; cancelling would leave money in the
    day's totals that the guest has already got back. Stop and settle instead."""
    from core.db.models import PaymentMethod
    from core.services.payments import add_payment

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
    await add_payment(
        db_session,
        session_id=session.id,
        amount=150,
        method=PaymentMethod.cash,
        now=T + timedelta(seconds=10),
    )

    with pytest.raises(ConflictError, match="payment"):
        await cancel_session(db_session, session_id=session.id, now=T + timedelta(seconds=30))

    await db_session.refresh(session)
    assert session.status == SessionStatus.active
    assert session.segments[0].amount == 150
    entries = (
        (await db_session.execute(select(AuditLog).where(AuditLog.entity_id == session.id)))
        .scalars()
        .all()
    )
    assert not any(e.action == "cancel" for e in entries)


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", [SessionKind.paid, SessionKind.free])
async def test_cancelling_open_time_inside_grace_never_ends_a_segment_before_it_starts(
    db_session, kind
):
    """Open time starts when the grace window ends, so cancelling inside the window must not
    stamp ends_at earlier than starts_at (stop_session already clamps it)."""
    console_id, _, open_id = await _setup(db_session)
    session = await start_session(
        db_session,
        console_id=console_id,
        kind=kind,
        tariff_id=open_id if kind == SessionKind.paid else None,
        reason="friends" if kind == SessionKind.free else None,
        comment=None,
        now=T,
    )

    cancelled = await cancel_session(
        db_session, session_id=session.id, now=T + timedelta(seconds=20)
    )

    segment = cancelled.segments[0]
    assert segment.ends_at is not None
    assert segment.ends_at >= segment.starts_at
    assert segment.amount == 0
