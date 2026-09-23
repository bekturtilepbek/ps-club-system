from datetime import UTC, datetime, timedelta

import pytest

from core.db.models import Console, PaymentMethod, SessionKind, Tariff, TariffKind, Zone
from core.services.business_days import open_business_day
from core.services.errors import NotFoundError
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
async def test_charge_total_and_balance_after_partial_cash_and_qr_payment(db_session):
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
    await add_payment(db_session, session_id=session.id, amount=50, method=PaymentMethod.qr, now=T)

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
