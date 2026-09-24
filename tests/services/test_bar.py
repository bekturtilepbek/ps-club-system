from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from core.db.models import AuditLog, BusinessDay, Product, Session, SessionKind, SessionStatus
from core.services.bar import add_order, list_active_products, remove_order, session_orders_total
from core.services.errors import NotFoundError, ValidationError

T = datetime(2026, 9, 24, 12, 0, 0, tzinfo=UTC)


async def _setup(db_session):
    day = BusinessDay(opened_at=T, opening_cash=5000)
    db_session.add(day)
    await db_session.flush()
    session = Session(
        business_day_id=day.id,
        kind=SessionKind.paid,
        status=SessionStatus.active,
        started_at=T,
        grace_until=T,
    )
    cola = Product(name="Кола", price=80, is_active=True)
    water = Product(name="Вода", price=50, is_active=False)
    db_session.add_all([session, cola, water])
    await db_session.flush()
    await db_session.commit()
    return session.id, cola.id, water.id


@pytest.mark.asyncio
async def test_list_active_products_excludes_inactive(db_session):
    _, cola_id, water_id = await _setup(db_session)

    products = await list_active_products(db_session)

    ids = {p.id for p in products}
    assert cola_id in ids
    assert water_id not in ids


@pytest.mark.asyncio
async def test_add_order_snapshots_the_product_price(db_session):
    session_id, cola_id, _ = await _setup(db_session)

    order = await add_order(db_session, session_id=session_id, product_id=cola_id, qty=2, now=T)

    assert order.qty == 2
    assert order.unit_price == 80
    assert await session_orders_total(db_session, session_id) == 160


@pytest.mark.asyncio
async def test_add_order_rejects_an_inactive_product(db_session):
    session_id, _, water_id = await _setup(db_session)

    with pytest.raises(NotFoundError):
        await add_order(db_session, session_id=session_id, product_id=water_id, qty=1, now=T)


@pytest.mark.asyncio
async def test_add_order_rejects_a_non_positive_quantity(db_session):
    session_id, cola_id, _ = await _setup(db_session)

    with pytest.raises(ValidationError):
        await add_order(db_session, session_id=session_id, product_id=cola_id, qty=0, now=T)


@pytest.mark.asyncio
async def test_add_order_to_an_unknown_session_is_not_found(db_session):
    _, cola_id, _ = await _setup(db_session)

    with pytest.raises(NotFoundError):
        await add_order(db_session, session_id=999, product_id=cola_id, qty=1, now=T)


@pytest.mark.asyncio
async def test_remove_order_drops_it_from_the_total_and_writes_an_audit_entry(db_session):
    session_id, cola_id, _ = await _setup(db_session)
    order = await add_order(db_session, session_id=session_id, product_id=cola_id, qty=1, now=T)

    await remove_order(db_session, order_id=order.id, now=T)

    assert await session_orders_total(db_session, session_id) == 0
    result = await db_session.execute(select(AuditLog).where(AuditLog.action == "order_remove"))
    logged = result.scalars().one()
    assert logged.entity_id == order.id
    assert logged.details["product_id"] == cola_id


@pytest.mark.asyncio
async def test_remove_unknown_order_is_not_found(db_session):
    with pytest.raises(NotFoundError):
        await remove_order(db_session, order_id=999, now=T)
