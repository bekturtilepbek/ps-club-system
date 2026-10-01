from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import update

from core.db.models import (
    Console,
    Order,
    PaymentMethod,
    Product,
    SegmentKind,
    SessionKind,
    SessionSegment,
    Tariff,
    TariffKind,
    Zone,
)
from core.services.bar import add_order
from core.services.business_days import close_business_day, open_business_day
from core.services.errors import NotFoundError
from core.services.feed import FeedKind, day_feed
from core.services.payments import add_payment
from core.services.sessions import extend_session, open_ticket, start_session, stop_session

T = datetime(2026, 9, 29, 4, 0, 0, tzinfo=UTC)


async def _hall(db_session):
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    console = Console(zone_id=zone.id, name="PS 1")
    three_hours = Tariff(
        zone_id=zone.id, kind=TariffKind.package, name="3 часа", duration_min=180, price=400
    )
    one_hour = Tariff(
        zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150
    )
    cola = Product(name="Кола", price=60, is_active=True)
    db_session.add_all([console, three_hours, one_hour, cola])
    await db_session.commit()
    return console, three_hours, one_hour, cola


async def test_feed_tells_the_day_newest_first(db_session):
    console, three_hours, one_hour, cola = await _hall(db_session)
    day = await open_business_day(db_session, opening_cash=0, now=T)

    session = await start_session(
        db_session, console_id=console.id, kind=SessionKind.paid, tariff_id=three_hours.id,
        reason=None, comment=None, now=T + timedelta(minutes=1),
    )
    await add_order(
        db_session, session_id=session.id, product_id=cola.id, qty=2,
        now=T + timedelta(minutes=30),
    )
    await extend_session(
        db_session, session_id=session.id, tariff_id=one_hour.id, now=T + timedelta(hours=2)
    )
    await add_payment(
        db_session, session_id=session.id, amount=670, method=PaymentMethod.transfer,
        now=T + timedelta(hours=3),
    )
    await stop_session(db_session, session_id=session.id, now=T + timedelta(hours=4))

    events = await day_feed(db_session, business_day_id=day.id)

    assert [e.kind for e in events] == [
        FeedKind.session_finished,
        FeedKind.payment,
        FeedKind.session_extended,
        FeedKind.order,
        FeedKind.session_started,
    ]
    finished, payment, extended, order, started = events
    assert all(e.console_name == "PS 1" and e.session_id == session.id for e in events)
    assert (started.segment_kind, started.tariff_name) == (SegmentKind.package, "3 часа")
    assert (order.product_name, order.qty, order.amount) == ("Кола", 2, 120)
    assert (extended.tariff_name, extended.at) == ("1 час", T + timedelta(hours=2))
    assert (payment.amount, payment.method) == (670, PaymentMethod.transfer)
    assert finished.minutes == 239


async def test_feed_leaves_out_other_days(db_session):
    console, three_hours, _, _ = await _hall(db_session)
    first = await open_business_day(db_session, opening_cash=0, now=T)
    session = await start_session(
        db_session, console_id=console.id, kind=SessionKind.paid, tariff_id=three_hours.id,
        reason=None, comment=None, now=T + timedelta(minutes=1),
    )
    await stop_session(db_session, session_id=session.id, now=T + timedelta(hours=1))
    await close_business_day(
        db_session, business_day_id=first.id, counted_cash=0, now=T + timedelta(hours=2)
    )

    second = await open_business_day(db_session, opening_cash=0, now=T + timedelta(days=1))
    assert await day_feed(db_session, business_day_id=second.id) == []


async def test_feed_of_an_unknown_day_is_not_found(db_session):
    with pytest.raises(NotFoundError):
        await day_feed(db_session, business_day_id=999)


async def test_feed_follows_the_session_day_not_the_clock(db_session):
    console, three_hours, one_hour, cola = await _hall(db_session)
    day_a = await open_business_day(db_session, opening_cash=0, now=T)
    session = await start_session(
        db_session, console_id=console.id, kind=SessionKind.paid, tariff_id=three_hours.id,
        reason=None, comment=None, now=T + timedelta(minutes=1),
    )
    await extend_session(
        db_session, session_id=session.id, tariff_id=one_hour.id, now=T + timedelta(hours=1)
    )
    await add_order(
        db_session, session_id=session.id, product_id=cola.id, qty=1, now=T + timedelta(hours=1)
    )
    await stop_session(db_session, session_id=session.id, now=T + timedelta(hours=2))
    await close_business_day(
        db_session, business_day_id=day_a.id, counted_cash=0, now=T + timedelta(hours=3)
    )
    day_b = await open_business_day(db_session, opening_cash=0, now=T + timedelta(days=1))

    # Make the session's later events happen inside day B's window.
    later = T + timedelta(days=1, hours=1)
    await db_session.execute(
        update(SessionSegment)
        .where(SessionSegment.session_id == session.id)
        .values(created_at=later)
    )
    await db_session.execute(
        update(Order).where(Order.session_id == session.id).values(created_at=later)
    )
    await db_session.execute(
        update(type(session)).where(type(session).id == session.id).values(ended_at=later)
    )
    await db_session.commit()

    in_a = await day_feed(db_session, business_day_id=day_a.id)
    assert {e.kind for e in in_a} == {
        FeedKind.session_started,
        FeedKind.session_extended,
        FeedKind.order,
        FeedKind.session_finished,
    }
    assert await day_feed(db_session, business_day_id=day_b.id) == []


async def test_walk_in_ticket_lists_orders_and_payments_but_no_start(db_session):
    _, _, _, cola = await _hall(db_session)
    day = await open_business_day(db_session, opening_cash=0, now=T)
    ticket = await open_ticket(db_session, now=T + timedelta(minutes=1))
    await add_order(
        db_session, session_id=ticket.id, product_id=cola.id, qty=1, now=T + timedelta(minutes=2)
    )
    await add_payment(
        db_session, session_id=ticket.id, amount=60, method=PaymentMethod.cash,
        now=T + timedelta(minutes=3),
    )

    events = await day_feed(db_session, business_day_id=day.id)

    assert [e.kind for e in events] == [FeedKind.payment, FeedKind.order]
    assert all(e.console_name is None and e.session_id == ticket.id for e in events)


async def test_events_at_the_same_moment_keep_a_stable_order(db_session):
    console, three_hours, _, cola = await _hall(db_session)
    day = await open_business_day(db_session, opening_cash=0, now=T)
    at = T + timedelta(minutes=5)
    session = await start_session(
        db_session, console_id=console.id, kind=SessionKind.paid, tariff_id=three_hours.id,
        reason=None, comment=None, now=at,
    )
    await add_order(db_session, session_id=session.id, product_id=cola.id, qty=1, now=at)
    await add_payment(
        db_session, session_id=session.id, amount=460, method=PaymentMethod.cash, now=at
    )

    events = await day_feed(db_session, business_day_id=day.id)

    assert [e.kind for e in events] == [FeedKind.payment, FeedKind.order, FeedKind.session_started]
