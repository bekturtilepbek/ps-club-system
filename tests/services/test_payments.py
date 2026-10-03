from datetime import UTC, datetime, timedelta

import pytest

from core.db.models import (
    Console,
    PaymentMethod,
    SessionKind,
    SessionStatus,
    Tariff,
    TariffKind,
    Zone,
)
from core.services.business_days import open_business_day
from core.services.errors import ConflictError, NotFoundError
from core.services.payments import (
    add_payment,
    session_balance,
    session_charge_total,
    session_paid_total,
)
from core.services.sessions import start_session

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
    db_session.add(package)
    await db_session.flush()
    await open_business_day(db_session, opening_cash=5000, now=T)
    await db_session.commit()
    return console.id, package.id


@pytest.mark.asyncio
async def test_charge_total_for_a_package_is_its_price_even_while_running(db_session):
    console_id, package_id = await _setup(db_session)
    session = await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.paid,
        tariff_id=package_id,
        reason=None,
        comment=None,
        now=T,
    )

    assert await session_charge_total(db_session, session.id, now=T + timedelta(minutes=5)) == 150


@pytest.mark.asyncio
async def test_charge_total_and_balance_after_partial_cash_and_transfer_payment(db_session):
    console_id, package_id = await _setup(db_session)
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
        db_session, session_id=session.id, amount=100, method=PaymentMethod.cash, now=T
    )
    await add_payment(
        db_session, session_id=session.id, amount=50, method=PaymentMethod.transfer, now=T
    )

    assert await session_paid_total(db_session, session.id) == 150
    assert await session_balance(db_session, session.id, now=T) == 0


@pytest.mark.asyncio
async def test_balance_is_positive_before_full_payment(db_session):
    console_id, package_id = await _setup(db_session)
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
        db_session, session_id=session.id, amount=100, method=PaymentMethod.cash, now=T
    )

    assert await session_balance(db_session, session.id, now=T) == 50


@pytest.mark.asyncio
async def test_add_payment_to_unknown_session_is_not_found(db_session):
    with pytest.raises(NotFoundError):
        await add_payment(db_session, session_id=999, amount=100, method=PaymentMethod.cash, now=T)


@pytest.mark.asyncio
async def test_free_session_always_has_zero_charge_total(db_session):
    console_id, _ = await _setup(db_session)
    session = await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.free,
        tariff_id=None,
        reason="друг владельца",
        comment=None,
        now=T,
    )

    assert await session_charge_total(db_session, session.id, now=T + timedelta(hours=1)) == 0


@pytest.mark.asyncio
async def test_add_payment_attributes_to_the_currently_open_business_day_not_the_sessions(
    db_session,
):
    console_id, package_id = await _setup(db_session)
    session = await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.paid,
        tariff_id=package_id,
        reason=None,
        comment=None,
        now=T,
    )
    first_day_id = session.business_day_id

    from core.services.business_days import close_business_day, open_business_day

    # finish the session so the first day can close, then open a second day
    from core.services.sessions import stop_session

    await stop_session(db_session, session_id=session.id, now=T + timedelta(hours=1))
    await close_business_day(
        db_session, business_day_id=first_day_id, counted_cash=150, now=T + timedelta(hours=2)
    )
    second_day = await open_business_day(db_session, opening_cash=1000, now=T + timedelta(days=1))

    payment = await add_payment(
        db_session,
        session_id=session.id,
        amount=150,
        method=PaymentMethod.cash,
        now=T + timedelta(days=1, hours=1),
    )

    assert payment.business_day_id == second_day.id
    assert payment.business_day_id != first_day_id


@pytest.mark.asyncio
async def test_add_payment_without_an_open_business_day_is_a_conflict(db_session):
    console_id, package_id = await _setup(db_session)
    session = await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.paid,
        tariff_id=package_id,
        reason=None,
        comment=None,
        now=T,
    )

    from core.services.business_days import close_business_day
    from core.services.sessions import stop_session

    await stop_session(db_session, session_id=session.id, now=T + timedelta(hours=1))
    await close_business_day(
        db_session,
        business_day_id=session.business_day_id,
        counted_cash=150,
        now=T + timedelta(hours=2),
    )

    with pytest.raises(ConflictError):
        await add_payment(
            db_session, session_id=session.id, amount=150, method=PaymentMethod.cash, now=T
        )


@pytest.mark.asyncio
async def test_add_payment_rejects_a_non_positive_amount(db_session):
    from core.services.errors import ValidationError

    console_id, package_id = await _setup(db_session)
    session = await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.paid,
        tariff_id=package_id,
        reason=None,
        comment=None,
        now=T,
    )

    with pytest.raises(ValidationError):
        await add_payment(
            db_session, session_id=session.id, amount=0, method=PaymentMethod.cash, now=T
        )
    with pytest.raises(ValidationError):
        await add_payment(
            db_session, session_id=session.id, amount=-10, method=PaymentMethod.cash, now=T
        )


@pytest.mark.asyncio
async def test_charge_total_includes_bar_orders_on_a_paid_session(db_session):
    from core.db.models import Product
    from core.services.bar import add_order

    console_id, package_id = await _setup(db_session)
    session = await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.paid,
        tariff_id=package_id,
        reason=None,
        comment=None,
        now=T,
    )
    cola = Product(name="Кола", price=80, is_active=True)
    db_session.add(cola)
    await db_session.flush()

    await add_order(db_session, session_id=session.id, product_id=cola.id, qty=2, now=T)

    assert await session_charge_total(db_session, session.id, now=T) == 150 + 160


@pytest.mark.asyncio
async def test_free_session_still_charges_for_bar_orders(db_session):
    from core.db.models import Product
    from core.services.bar import add_order

    console_id, _ = await _setup(db_session)
    session = await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.free,
        tariff_id=None,
        reason="друг владельца",
        comment=None,
        now=T,
    )
    water = Product(name="Вода", price=50, is_active=True)
    db_session.add(water)
    await db_session.flush()

    await add_order(db_session, session_id=session.id, product_id=water.id, qty=1, now=T)

    assert await session_charge_total(db_session, session.id, now=T) == 50


@pytest.mark.asyncio
async def test_a_cancelled_session_takes_no_payments(db_session):
    """A cancelled session charges nothing: money put on it would just sit in the day's cash."""
    from core.db.models import Session

    console_id, package_id = await _setup(db_session)
    session = await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.paid,
        tariff_id=package_id,
        reason=None,
        comment=None,
        now=T,
    )
    cancelled = await db_session.get(Session, session.id)
    cancelled.status = SessionStatus.cancelled
    await db_session.commit()

    with pytest.raises(ConflictError, match="cancelled"):
        await add_payment(
            db_session,
            session_id=session.id,
            amount=150,
            method=PaymentMethod.cash,
            now=T + timedelta(seconds=10),
        )

    assert await session_paid_total(db_session, session.id) == 0


@pytest.mark.asyncio
async def test_a_stopped_session_can_still_be_paid_off(db_session):
    """Settling after "Стоп" is the normal way a bill is paid."""
    from core.services.sessions import stop_session

    console_id, package_id = await _setup(db_session)
    session = await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.paid,
        tariff_id=package_id,
        reason=None,
        comment=None,
        now=T,
    )
    await stop_session(db_session, session_id=session.id, now=T + timedelta(minutes=30))

    await add_payment(
        db_session,
        session_id=session.id,
        amount=150,
        method=PaymentMethod.cash,
        now=T + timedelta(minutes=31),
    )

    assert await session_paid_total(db_session, session.id) == 150
