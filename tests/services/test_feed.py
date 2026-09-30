from datetime import UTC, datetime, timedelta

import pytest

from core.db.models import (
    Console,
    PaymentMethod,
    Product,
    SegmentKind,
    SessionKind,
    Tariff,
    TariffKind,
    Zone,
)
from core.services.bar import add_order
from core.services.business_days import close_business_day, open_business_day
from core.services.errors import NotFoundError
from core.services.feed import FeedKind, day_feed
from core.services.payments import add_payment
from core.services.sessions import extend_session, start_session, stop_session

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
        db_session, session_id=session.id, amount=670, method=PaymentMethod.qr,
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
    assert (payment.amount, payment.method) == (670, PaymentMethod.qr)
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
