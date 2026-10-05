from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from core.db.models import (
    BusinessDay,
    Console,
    Game,
    Order,
    Payment,
    PaymentMethod,
    Product,
    SegmentKind,
    Session,
    SessionKind,
    SessionSegment,
    SessionStatus,
    Zone,
)
from core.services import analytics

TZ = ZoneInfo("Asia/Bishkek")
NOW = datetime(2026, 9, 30, 12, 0, tzinfo=TZ)
TODAY = date(2026, 9, 30)


def at(day: int, hour: int, minute: int = 0) -> datetime:
    """2026-09-<day> on the club clock. 2026-09-14 is a Monday."""
    return datetime(2026, 9, day, hour, minute, tzinfo=TZ)


async def make_hall(db, consoles: int = 2) -> list[int]:
    zone = Zone(name="Зал", is_active=True)
    db.add(zone)
    await db.flush()
    rows = [Console(zone_id=zone.id, name=f"PS5-{i + 1}") for i in range(consoles)]
    db.add_all(rows)
    await db.flush()
    return [row.id for row in rows]


async def make_day(db, opened: datetime, *, closed: bool = True) -> int:
    day = BusinessDay(
        opened_at=opened,
        closed_at=opened + timedelta(hours=12) if closed else None,
        opening_cash=0,
    )
    db.add(day)
    await db.flush()
    return day.id


async def make_session(
    db,
    *,
    day_id: int,
    console_id: int | None,
    start: datetime,
    minutes: int,
    amount: int,
    kind: SessionKind = SessionKind.paid,
    status: SessionStatus = SessionStatus.finished,
    game_id: int | None = None,
) -> Session:
    end = start + timedelta(minutes=minutes)
    session = Session(
        console_id=console_id,
        business_day_id=day_id,
        kind=kind,
        status=status,
        started_at=start,
        ended_at=end if status == SessionStatus.finished else None,
        game_id=game_id,
    )
    db.add(session)
    await db.flush()
    db.add(
        SessionSegment(
            session_id=session.id,
            kind=SegmentKind.package,
            starts_at=start,
            ends_at=end,
            price_snapshot=amount,
            amount=amount,
        )
    )
    await db.flush()
    return session


async def pay(db, session: Session, amount: int, method: PaymentMethod, when: datetime) -> None:
    db.add(
        Payment(
            session_id=session.id,
            business_day_id=session.business_day_id,
            amount=amount,
            method=method,
            created_at=when,
        )
    )
    await db.flush()


@pytest.mark.asyncio
async def test_resolve_range_clamps_to_the_first_day_and_today(db_session):
    await make_hall(db_session)
    await make_day(db_session, at(10, 10))
    await db_session.commit()

    result = await analytics.resolve_range(
        db_session, date_from=date(2020, 1, 1), date_to=date(2030, 1, 1), today=TODAY
    )
    assert result == (date(2026, 9, 10), TODAY)


@pytest.mark.asyncio
async def test_resolve_range_without_any_day_collapses_to_today(db_session):
    result = await analytics.resolve_range(
        db_session, date_from=date(2020, 1, 1), date_to=date(2030, 1, 1), today=TODAY
    )
    assert result == (TODAY, TODAY)


@pytest.mark.asyncio
async def test_summary_splits_cash_and_transfer_and_computes_the_average_check(db_session):
    console_a, console_b = await make_hall(db_session)
    day_id = await make_day(db_session, at(14, 10))
    s1 = await make_session(
        db_session, day_id=day_id, console_id=console_a, start=at(14, 11), minutes=60, amount=300
    )
    s2 = await make_session(
        db_session, day_id=day_id, console_id=console_b, start=at(14, 12), minutes=60, amount=200
    )
    await pay(db_session, s1, 300, PaymentMethod.cash, at(14, 12))
    await pay(db_session, s2, 200, PaymentMethod.transfer, at(14, 13))
    await db_session.commit()

    result = await analytics.summary(
        db_session, date_from=date(2026, 9, 14), date_to=date(2026, 9, 14), today=TODAY, now=NOW
    )

    assert (result.current.cash_total, result.current.transfer_total) == (300, 200)
    assert result.current.revenue_total == 500
    assert result.current.paid_sessions_count == 2
    assert result.current.avg_check == 250
    assert result.includes_open_day is False


@pytest.mark.asyncio
async def test_summary_reports_free_and_service_time_apart_and_keeps_tickets_out_of_the_count(
    db_session,
):
    console_a, _ = await make_hall(db_session)
    day_id = await make_day(db_session, at(14, 10))
    await make_session(
        db_session,
        day_id=day_id,
        console_id=console_a,
        start=at(14, 11),
        minutes=90,
        amount=0,
        kind=SessionKind.free,
    )
    await make_session(
        db_session,
        day_id=day_id,
        console_id=console_a,
        start=at(14, 13),
        minutes=30,
        amount=0,
        kind=SessionKind.service,
    )
    ticket = await make_session(
        db_session, day_id=day_id, console_id=None, start=at(14, 14), minutes=1, amount=0
    )
    product = Product(name="Кола", price=100)
    db_session.add(product)
    await db_session.flush()
    db_session.add(
        Order(
            session_id=ticket.id,
            product_id=product.id,
            qty=2,
            unit_price=100,
            created_at=at(14, 14),
        )
    )
    await db_session.commit()

    current = (
        await analytics.summary(
            db_session, date_from=date(2026, 9, 14), date_to=date(2026, 9, 14), today=TODAY, now=NOW
        )
    ).current

    assert current.free_minutes == 90
    assert current.service_minutes == 30
    assert (
        current.paid_sessions_count == 0
    )  # free, service and a no-console ticket are not paid visits
    assert current.bar_sales_total == 200
    assert current.avg_check is None


@pytest.mark.asyncio
async def test_summary_bar_per_session_counts_only_sessions_with_bar(db_session):
    console_a, console_b = await make_hall(db_session)
    day_id = await make_day(db_session, at(14, 10))
    s1 = await make_session(
        db_session, day_id=day_id, console_id=console_a, start=at(14, 11), minutes=60, amount=150
    )
    await make_session(
        db_session, day_id=day_id, console_id=console_b, start=at(14, 12), minutes=60, amount=150
    )
    product = Product(name="Чипсы", price=80)
    db_session.add(product)
    await db_session.flush()
    db_session.add(
        Order(
            session_id=s1.id, product_id=product.id, qty=3, unit_price=80, created_at=at(14, 11, 30)
        )
    )
    await db_session.commit()

    current = (
        await analytics.summary(
            db_session, date_from=date(2026, 9, 14), date_to=date(2026, 9, 14), today=TODAY, now=NOW
        )
    ).current

    assert current.bar_per_session == 240  # 240 on the one session that had a bar order, not 120


@pytest.mark.asyncio
async def test_summary_compares_with_the_previous_period_and_ignores_cancelled(db_session):
    console_a, _ = await make_hall(db_session)
    prev_day = await make_day(db_session, at(7, 10))
    this_day = await make_day(db_session, at(14, 10))
    old = await make_session(
        db_session, day_id=prev_day, console_id=console_a, start=at(7, 11), minutes=60, amount=100
    )
    new = await make_session(
        db_session, day_id=this_day, console_id=console_a, start=at(14, 11), minutes=60, amount=150
    )
    cancelled = await make_session(
        db_session,
        day_id=this_day,
        console_id=console_a,
        start=at(14, 15),
        minutes=5,
        amount=999,
        status=SessionStatus.cancelled,
    )
    await pay(db_session, old, 100, PaymentMethod.cash, at(7, 12))
    await pay(db_session, new, 150, PaymentMethod.cash, at(14, 12))
    await db_session.commit()
    assert cancelled.status == SessionStatus.cancelled

    result = await analytics.summary(
        db_session, date_from=date(2026, 9, 8), date_to=date(2026, 9, 14), today=TODAY, now=NOW
    )

    assert result.current.paid_sessions_count == 1
    assert result.previous.revenue_total == 100
    assert result.changes["revenue_total"] == 50.0
    assert result.changes["free_minutes"] is None  # both zero: nothing to compare


@pytest.mark.asyncio
async def test_summary_flags_an_open_day_and_runs_active_sessions_until_now(db_session):
    console_a, _ = await make_hall(db_session)
    day_id = await make_day(db_session, at(30, 10), closed=False)
    session = Session(
        console_id=console_a,
        business_day_id=day_id,
        kind=SessionKind.free,
        status=SessionStatus.active,
        started_at=at(30, 11),
    )
    db_session.add(session)
    await db_session.flush()
    db_session.add(
        SessionSegment(
            session_id=session.id,
            kind=SegmentKind.open,
            starts_at=at(30, 11),
            ends_at=None,
            price_snapshot=0,
        )
    )
    await db_session.commit()

    result = await analytics.summary(
        db_session, date_from=date(2026, 9, 30), date_to=date(2026, 9, 30), today=TODAY, now=NOW
    )

    assert result.includes_open_day is True
    assert result.current.free_minutes == 60  # 11:00 -> now (12:00)


@pytest.mark.asyncio
async def test_revenue_series_fills_empty_buckets_and_groups_by_week(db_session):
    console_a, _ = await make_hall(db_session)
    day_one = await make_day(db_session, at(14, 10))  # Monday
    day_two = await make_day(db_session, at(24, 10))  # Thursday of the next-but-one week
    s1 = await make_session(
        db_session, day_id=day_one, console_id=console_a, start=at(14, 11), minutes=60, amount=100
    )
    s2 = await make_session(
        db_session, day_id=day_two, console_id=console_a, start=at(24, 11), minutes=60, amount=70
    )
    await pay(db_session, s1, 100, PaymentMethod.cash, at(14, 12))
    await pay(db_session, s2, 70, PaymentMethod.transfer, at(24, 12))
    await db_session.commit()

    date_from, date_to, points = await analytics.revenue_series(
        db_session,
        date_from=date(2026, 9, 14),
        date_to=date(2026, 9, 27),
        group="week",
        today=TODAY,
    )
    assert [(p.period_start, p.cash_total, p.transfer_total) for p in points] == [
        (date(2026, 9, 14), 100, 0),
        (date(2026, 9, 21), 0, 70),
    ]
    assert (date_from, date_to) == (date(2026, 9, 14), date(2026, 9, 27))


@pytest.mark.asyncio
async def test_load_uses_real_clock_hours_and_excludes_service(db_session):
    console_a, _ = await make_hall(db_session, consoles=2)
    # One day, opened Monday 14.09; the session runs Monday 23:30 -> Tuesday 00:30.
    day_id = await make_day(db_session, at(14, 20))
    await make_session(
        db_session,
        day_id=day_id,
        console_id=console_a,
        start=at(14, 23, 30),
        minutes=60,
        amount=100,
    )
    await make_session(
        db_session,
        day_id=day_id,
        console_id=console_a,
        start=at(14, 21),
        minutes=60,
        amount=0,
        kind=SessionKind.service,
    )
    await db_session.commit()

    result = await analytics.load(
        db_session, date_from=date(2026, 9, 14), date_to=date(2026, 9, 20), today=TODAY, now=NOW
    )

    assert result.consoles_count == 2
    cell = {(c.weekday, c.hour): c for c in result.cells}
    assert cell[(0, 23)].busy_minutes == 30  # Monday 23:30-24:00
    assert cell[(1, 0)].busy_minutes == 30  # Tuesday 00:00-00:30, a different weekday
    assert cell[(0, 21)].busy_minutes == 0  # the service session is not load
    assert cell[(0, 23)].load_percent == round(30 / (2 * 60) * 100, 1)
    assert result.busiest is not None


@pytest.mark.asyncio
async def test_bar_sales_ranks_products_by_revenue(db_session):
    console_a, _ = await make_hall(db_session)
    day_id = await make_day(db_session, at(14, 10))
    session = await make_session(
        db_session, day_id=day_id, console_id=console_a, start=at(14, 11), minutes=60, amount=100
    )
    cola = Product(name="Кола", price=100)
    chips = Product(name="Чипсы", price=80)
    db_session.add_all([cola, chips])
    await db_session.flush()
    db_session.add_all(
        [
            Order(
                session_id=session.id,
                product_id=cola.id,
                qty=1,
                unit_price=100,
                created_at=at(14, 12),
            ),
            Order(
                session_id=session.id,
                product_id=chips.id,
                qty=3,
                unit_price=80,
                created_at=at(14, 12),
            ),
        ]
    )
    await db_session.commit()

    _, _, rows = await analytics.bar_sales(
        db_session, date_from=date(2026, 9, 14), date_to=date(2026, 9, 14), today=TODAY
    )

    assert [(r.name, r.qty, r.revenue) for r in rows] == [("Чипсы", 3, 240), ("Кола", 1, 100)]


@pytest.mark.asyncio
async def test_games_ranking_groups_sessions_without_a_game_into_one_row(db_session):
    console_a, console_b = await make_hall(db_session)
    day_id = await make_day(db_session, at(14, 10))
    fifa = Game(name="FC 26")
    db_session.add(fifa)
    await db_session.flush()
    await make_session(
        db_session,
        day_id=day_id,
        console_id=console_a,
        start=at(14, 11),
        minutes=60,
        amount=150,
        game_id=fifa.id,
    )
    await make_session(
        db_session,
        day_id=day_id,
        console_id=console_b,
        start=at(14, 11),
        minutes=60,
        amount=150,
        game_id=fifa.id,
    )
    await make_session(
        db_session, day_id=day_id, console_id=console_a, start=at(14, 13), minutes=60, amount=90
    )
    await db_session.commit()

    _, _, rows = await analytics.games_ranking(
        db_session, date_from=date(2026, 9, 14), date_to=date(2026, 9, 14), today=TODAY
    )

    assert [(r.name, r.sessions, r.revenue) for r in rows] == [("FC 26", 2, 300), (None, 1, 90)]
