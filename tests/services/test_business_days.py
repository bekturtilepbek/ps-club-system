import asyncio
import os
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.db.models import (
    Console,
    Order,
    Payment,
    PaymentMethod,
    Product,
    SegmentKind,
    Session,
    SessionKind,
    SessionSegment,
    SessionStatus,
    Setting,
    Zone,
)
from core.services.business_days import (
    claim_unclosed_day_reminder,
    close_business_day,
    day_summary,
    get_open_business_day,
    list_business_days,
    open_business_day,
    summaries_for_days,
)
from core.services.errors import ConflictError, NotFoundError

T = datetime(2026, 9, 23, 10, 0, 0, tzinfo=UTC)

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test"
)


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
            method=PaymentMethod.transfer,
            created_at=T,
        )
    )
    await db_session.commit()

    closed = await close_business_day(
        db_session, business_day_id=day.id, counted_cash=5300, now=T + timedelta(hours=8)
    )
    assert closed.expected_cash == 5300  # 5000 opening + 300 cash, non-cash excluded
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
    db_session.add(
        Session(
            console_id=console.id,
            business_day_id=day.id,
            kind=SessionKind.paid,
            status=SessionStatus.active,
            started_at=T,
            grace_until=T,
        )
    )
    await db_session.commit()

    with pytest.raises(ConflictError):
        await close_business_day(db_session, business_day_id=day.id, counted_cash=5000, now=T)


@pytest.mark.asyncio
async def test_concurrent_opens_only_one_succeeds(db_session):
    engine2 = create_async_engine(TEST_DATABASE_URL)
    session_factory2 = async_sessionmaker(engine2, expire_on_commit=False)
    async with session_factory2() as db_session2:
        results = await asyncio.gather(
            open_business_day(db_session, opening_cash=5000, now=T),
            open_business_day(db_session2, opening_cash=1000, now=T),
            return_exceptions=True,
        )
    await engine2.dispose()

    successes = [r for r in results if not isinstance(r, BaseException)]
    failures = [r for r in results if isinstance(r, BaseException)]
    assert len(successes) == 1
    assert len(failures) == 1
    assert isinstance(failures[0], ConflictError)


@pytest.mark.asyncio
async def test_day_summary_of_unknown_day_raises_not_found(db_session):
    with pytest.raises(NotFoundError):
        await day_summary(db_session, business_day_id=999, now=T)


@pytest.mark.asyncio
async def test_day_summary_breaks_down_payments_by_method(db_session):
    day = await open_business_day(db_session, opening_cash=5000, now=T)
    session_id = await _make_finished_session(db_session, day.id)
    db_session.add_all(
        [
            Payment(
                session_id=session_id,
                business_day_id=day.id,
                amount=300,
                method=PaymentMethod.cash,
                created_at=T,
            ),
            Payment(
                session_id=session_id,
                business_day_id=day.id,
                amount=200,
                method=PaymentMethod.transfer,
                created_at=T,
            ),
            Payment(
                session_id=session_id,
                business_day_id=day.id,
                amount=100,
                method=PaymentMethod.transfer,
                created_at=T,
            ),
        ]
    )
    await db_session.commit()

    summary = await day_summary(db_session, business_day_id=day.id, now=T)

    assert summary.opening_cash == 5000
    assert summary.cash_total == 300
    assert summary.transfer_total == 300
    assert summary.revenue_total == 600  # cash and transfers together, no opening cash
    assert summary.expected_cash == 5300
    assert summary.has_active_sessions is False


@pytest.mark.asyncio
async def test_day_summary_counts_sessions_minutes_and_bar_sales_excluding_cancelled(db_session):
    day = await open_business_day(db_session, opening_cash=5000, now=T)
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    console = Console(zone_id=zone.id, name="PS5-1")
    db_session.add(console)
    await db_session.flush()
    product = Product(name="Кола", price=80, is_active=True)
    db_session.add(product)
    await db_session.flush()

    finished = Session(
        console_id=console.id,
        business_day_id=day.id,
        kind=SessionKind.paid,
        status=SessionStatus.finished,
        started_at=T,
        grace_until=T,
        ended_at=T + timedelta(hours=1),
    )
    finished.segments.append(
        SessionSegment(
            kind=SegmentKind.package,
            starts_at=T,
            ends_at=T + timedelta(hours=1),
            price_snapshot=150,
            amount=150,
        )
    )
    finished.orders.append(Order(product_id=product.id, qty=2, unit_price=80, created_at=T))
    db_session.add(finished)

    active = Session(
        console_id=None,
        business_day_id=day.id,
        kind=SessionKind.paid,
        status=SessionStatus.active,
        started_at=T,
        grace_until=None,
    )
    db_session.add(active)

    cancelled = Session(
        console_id=None,
        business_day_id=day.id,
        kind=SessionKind.paid,
        status=SessionStatus.cancelled,
        started_at=T,
        grace_until=None,
        ended_at=T,
    )
    db_session.add(cancelled)
    await db_session.commit()

    summary = await day_summary(db_session, business_day_id=day.id, now=T + timedelta(hours=1))

    assert summary.sessions_count == 1  # cancelled excluded; a walk-in bar ticket is not a session
    assert summary.minutes_total == 60  # only the finished session's 1h package segment
    assert summary.bar_sales_total == 160
    assert summary.has_active_sessions is True


@pytest.mark.asyncio
async def test_day_summary_bills_an_open_still_running_segment_up_to_now(db_session):
    day = await open_business_day(db_session, opening_cash=5000, now=T)
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    console = Console(zone_id=zone.id, name="PS5-1")
    db_session.add(console)
    await db_session.flush()

    active = Session(
        console_id=console.id,
        business_day_id=day.id,
        kind=SessionKind.paid,
        status=SessionStatus.active,
        started_at=T,
        grace_until=T,
    )
    active.segments.append(
        SessionSegment(
            kind=SegmentKind.open,
            starts_at=T,
            ends_at=None,
            price_snapshot=100,
            amount=None,
        )
    )
    db_session.add(active)
    await db_session.commit()

    summary = await day_summary(db_session, business_day_id=day.id, now=T + timedelta(minutes=45))

    assert summary.minutes_total == 45
    assert summary.has_active_sessions is True


@pytest.mark.asyncio
async def test_list_business_days_orders_newest_first_and_respects_limit(db_session):
    first = await open_business_day(db_session, opening_cash=1000, now=T)
    await close_business_day(
        db_session, business_day_id=first.id, counted_cash=1000, now=T + timedelta(hours=1)
    )
    second = await open_business_day(db_session, opening_cash=2000, now=T + timedelta(hours=2))
    await close_business_day(
        db_session, business_day_id=second.id, counted_cash=2000, now=T + timedelta(hours=3)
    )

    days = await list_business_days(db_session, limit=1)

    assert [d.id for d in days] == [second.id]


@pytest.mark.asyncio
async def test_day_summary_breaks_out_free_and_service_minutes(db_session):
    day = await open_business_day(db_session, opening_cash=5000, now=T)
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    console = Console(zone_id=zone.id, name="PS5-1")
    db_session.add(console)
    await db_session.flush()

    paid = Session(
        console_id=console.id,
        business_day_id=day.id,
        kind=SessionKind.paid,
        status=SessionStatus.finished,
        started_at=T,
        grace_until=T,
        ended_at=T + timedelta(hours=1),
    )
    paid.segments.append(
        SessionSegment(
            kind=SegmentKind.package,
            starts_at=T,
            ends_at=T + timedelta(hours=1),
            price_snapshot=150,
            amount=150,
        )
    )
    db_session.add(paid)

    free = Session(
        console_id=None,
        business_day_id=day.id,
        kind=SessionKind.free,
        reason="друг",
        status=SessionStatus.finished,
        started_at=T,
        grace_until=T,
        ended_at=T + timedelta(minutes=30),
    )
    free.segments.append(
        SessionSegment(
            kind=SegmentKind.open,
            starts_at=T,
            ends_at=T + timedelta(minutes=30),
            price_snapshot=0,
            amount=0,
        )
    )
    db_session.add(free)
    await db_session.commit()

    summary = await day_summary(db_session, business_day_id=day.id, now=T + timedelta(hours=1))

    assert summary.minutes_total == 90
    assert summary.free_minutes_total == 30


@pytest.mark.asyncio
async def test_claim_unclosed_day_reminder_is_none_when_no_day_open(db_session):
    assert await claim_unclosed_day_reminder(db_session, now=T) is None


@pytest.mark.asyncio
async def test_claim_unclosed_day_reminder_is_none_before_the_threshold(db_session):
    # T is UTC 10:00 = Bishkek 16:00 (UTC+6). planned_close (default 05:00 Bishkek)
    # next occurs at Bishkek 05:00 the following day, i.e. +13h in UTC terms;
    # + 60min default threshold -> due_at = +14h. One minute before that is still
    # too soon.
    day = await open_business_day(db_session, opening_cash=5000, now=T)

    result = await claim_unclosed_day_reminder(db_session, now=T + timedelta(hours=13, minutes=59))
    assert result is None
    await db_session.refresh(day)
    assert day.last_reminder_at is None


@pytest.mark.asyncio
async def test_claim_unclosed_day_reminder_fires_once_past_the_threshold(db_session):
    day = await open_business_day(db_session, opening_cash=5000, now=T)
    # T is UTC 10:00 = Bishkek 16:00; planned_close (+13h, 05:00 Bishkek next day)
    # + 60min default threshold -> due_at = +14h.
    due_at = T + timedelta(hours=14)

    result = await claim_unclosed_day_reminder(db_session, now=due_at)

    assert result is not None
    assert result.id == day.id
    assert result.last_reminder_at == due_at


@pytest.mark.asyncio
async def test_claim_unclosed_day_reminder_waits_the_interval_before_firing_again(db_session):
    day = await open_business_day(db_session, opening_cash=5000, now=T)
    first_due = T + timedelta(hours=14)  # planned_close (+13h) + 60min default threshold
    await claim_unclosed_day_reminder(db_session, now=first_due)

    too_soon = await claim_unclosed_day_reminder(db_session, now=first_due + timedelta(minutes=30))
    assert too_soon is None

    second_due = await claim_unclosed_day_reminder(
        db_session, now=first_due + timedelta(minutes=60)
    )
    assert second_due is not None
    assert second_due.id == day.id


@pytest.mark.asyncio
async def test_claim_unclosed_day_reminder_respects_configured_threshold(db_session):
    db_session.add(Setting(key="day_reminder_threshold_minutes", value="10"))
    await db_session.commit()
    await open_business_day(db_session, opening_cash=5000, now=T)

    # planned_close (+13h, 05:00 Bishkek next day) + 10min configured
    # threshold -> due_at = +13h10min.
    too_soon = await claim_unclosed_day_reminder(db_session, now=T + timedelta(hours=13, minutes=9))
    assert too_soon is None

    due = await claim_unclosed_day_reminder(db_session, now=T + timedelta(hours=13, minutes=10))
    assert due is not None


@pytest.mark.asyncio
async def test_claim_unclosed_day_reminder_uses_bishkek_time_not_the_db_utc_tzinfo(db_session):
    # Reproduces the asyncpg TIMESTAMP(timezone=True) round-trip: a Bishkek-aware
    # `opened_at` is stored and re-read as the SAME INSTANT but tagged UTC (see
    # core/services/business_days.py's claim_unclosed_day_reminder). Opened at
    # Bishkek 2026-09-25 10:00 (= UTC 04:00). planned_close defaults to "05:00"
    # Bishkek, so the correct next occurrence is Bishkek 2026-09-26 05:00, plus the
    # default 60min threshold -> due at Bishkek 2026-09-26 06:00 (= UTC 00:00).
    bishkek_open = datetime(2026, 9, 25, 10, 0, tzinfo=ZoneInfo("Asia/Bishkek"))
    day = await open_business_day(db_session, opening_cash=5000, now=bishkek_open)

    # day.opened_at now comes back from a real commit/refresh, i.e. UTC-tagged —
    # this is the actual bug reproduction, not just an in-memory datetime.
    assert day.opened_at.tzinfo == UTC

    due_at_utc = datetime(2026, 9, 26, 0, 0, tzinfo=UTC)  # Bishkek 06:00 next day

    too_soon = await claim_unclosed_day_reminder(db_session, now=due_at_utc - timedelta(minutes=1))
    assert too_soon is None

    fired = await claim_unclosed_day_reminder(db_session, now=due_at_utc)
    assert fired is not None
    assert fired.id == day.id


async def test_summaries_for_days_keeps_each_day_apart(db_session):
    first = await open_business_day(db_session, opening_cash=1000, now=T)
    session_id = await _make_finished_session(db_session, first.id)
    db_session.add_all(
        [
            Payment(
                session_id=session_id,
                business_day_id=first.id,
                amount=300,
                method=PaymentMethod.cash,
                created_at=T,
            ),
            Payment(
                session_id=session_id,
                business_day_id=first.id,
                amount=200,
                method=PaymentMethod.transfer,
                created_at=T,
            ),
        ]
    )
    await db_session.commit()
    await close_business_day(
        db_session, business_day_id=first.id, counted_cash=1300, now=T + timedelta(hours=10)
    )

    second = await open_business_day(db_session, opening_cash=2000, now=T + timedelta(days=1))
    # A late payment for yesterday's session lands in the day it was taken (SPEC §3.4).
    db_session.add(
        Payment(
            session_id=session_id,
            business_day_id=second.id,
            amount=150,
            method=PaymentMethod.transfer,
            created_at=T + timedelta(days=1),
        )
    )
    await db_session.commit()

    now = T + timedelta(days=1, hours=2)
    summaries = await summaries_for_days(db_session, days=[first, second], now=now)

    assert summaries[first.id] == await day_summary(db_session, business_day_id=first.id, now=now)
    first_summary = summaries[first.id]
    assert (first_summary.cash_total, first_summary.transfer_total) == (300, 200)
    assert summaries[first.id].sessions_count == 1
    assert (summaries[second.id].cash_total, summaries[second.id].transfer_total) == (0, 150)
    assert summaries[second.id].expected_cash == 2000
    assert summaries[second.id].sessions_count == 0


async def test_summaries_for_days_of_nothing_is_empty(db_session):
    assert await summaries_for_days(db_session, days=[], now=T) == {}


async def _console(db_session) -> Console:
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    console = Console(zone_id=zone.id, name="PS5-1")
    db_session.add(console)
    await db_session.flush()
    return console


def _finished(day_id: int, console_id: int | None, kind: SessionKind, minutes: int, **extra):
    session = Session(
        console_id=console_id,
        business_day_id=day_id,
        kind=kind,
        status=SessionStatus.finished,
        started_at=T,
        grace_until=T,
        ended_at=T + timedelta(minutes=minutes),
        **extra,
    )
    session.segments.append(
        SessionSegment(
            kind=SegmentKind.open,
            starts_at=T,
            ends_at=T + timedelta(minutes=minutes),
            price_snapshot=0,
            amount=0,
        )
    )
    return session


@pytest.mark.asyncio
async def test_day_minutes_never_go_negative_while_open_time_is_queued_behind_a_package(db_session):
    """Open time bought during a running package starts at the package's end, in the future:
    until then it must add nothing, not subtract the time left until it starts."""
    day = await open_business_day(db_session, opening_cash=0, now=T)
    console = await _console(db_session)
    running = Session(
        console_id=console.id,
        business_day_id=day.id,
        kind=SessionKind.paid,
        status=SessionStatus.active,
        started_at=T,
        grace_until=T,
    )
    running.segments.append(
        SessionSegment(
            kind=SegmentKind.package,
            starts_at=T,
            ends_at=T + timedelta(hours=1),
            price_snapshot=150,
            amount=150,
        )
    )
    running.segments.append(
        SessionSegment(
            kind=SegmentKind.open,
            starts_at=T + timedelta(hours=1),
            ends_at=None,
            price_snapshot=120,
            amount=None,
        )
    )
    db_session.add(running)
    await db_session.commit()

    summary = await day_summary(db_session, business_day_id=day.id, now=T + timedelta(minutes=10))

    assert summary.minutes_total == 60  # the package; the queued open time adds nothing yet


@pytest.mark.asyncio
async def test_service_sessions_are_reported_apart_and_do_not_count_as_hall_load(db_session):
    day = await open_business_day(db_session, opening_cash=0, now=T)
    console = await _console(db_session)
    db_session.add_all(
        [
            _finished(day.id, console.id, SessionKind.paid, 60),
            _finished(day.id, console.id, SessionKind.free, 30, reason="друг"),
            _finished(day.id, console.id, SessionKind.service, 120),
        ]
    )
    await db_session.commit()

    summary = await day_summary(db_session, business_day_id=day.id, now=T + timedelta(hours=3))

    assert summary.sessions_count == 2  # paid + free; the firmware update is not a visit
    assert summary.minutes_total == 90  # paid 60 + free 30, no service time
    assert summary.free_minutes_total == 30  # free only
    assert summary.service_minutes_total == 120


@pytest.mark.asyncio
async def test_walk_in_bar_tickets_are_not_sessions_but_their_sales_still_count(db_session):
    day = await open_business_day(db_session, opening_cash=0, now=T)
    product = Product(name="Кола", price=80, is_active=True)
    db_session.add(product)
    await db_session.flush()
    ticket = Session(
        console_id=None,
        business_day_id=day.id,
        kind=SessionKind.paid,
        status=SessionStatus.finished,
        started_at=T,
        grace_until=None,
        ended_at=T,
    )
    ticket.orders.append(Order(product_id=product.id, qty=3, unit_price=80, created_at=T))
    db_session.add(ticket)
    await db_session.commit()

    summary = await day_summary(db_session, business_day_id=day.id, now=T + timedelta(hours=1))

    assert summary.sessions_count == 0
    assert summary.bar_sales_total == 240
