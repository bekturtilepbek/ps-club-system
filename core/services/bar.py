from datetime import datetime

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import AuditLog, Order, Product, SessionStatus
from core.db.models import Session as SessionModel
from core.services.errors import ConflictError, NotFoundError, ValidationError


async def list_active_products(db: AsyncSession) -> list[Product]:
    result = await db.execute(
        select(Product).where(Product.is_active.is_(True)).order_by(Product.id)
    )
    return list(result.scalars().all())


async def add_order(
    db: AsyncSession, *, session_id: int, product_id: int, qty: int, now: datetime
) -> Order:
    session = await db.get(SessionModel, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")
    if session.status != SessionStatus.active:
        # A finished bill is settled; items added now would change a total the guest may have paid.
        raise ConflictError(f"session {session_id} is not active")

    product = await db.get(Product, product_id)
    if product is None or not product.is_active:
        raise NotFoundError(f"product {product_id} not found or inactive")
    if qty <= 0:
        raise ValidationError("order quantity must be positive")

    order = Order(
        session_id=session_id,
        product_id=product_id,
        qty=qty,
        unit_price=product.price,  # price snapshot — CLAUDE.md rule 5
        created_at=now,
    )
    db.add(order)
    await db.execute(text("NOTIFY hall_changed"))
    await db.commit()
    await db.refresh(order)
    return order


async def session_orders_total(db: AsyncSession, session_id: int) -> int:
    result = await db.execute(select(Order).where(Order.session_id == session_id))
    return sum(order.qty * order.unit_price for order in result.scalars().all())


async def remove_order(db: AsyncSession, *, order_id: int, now: datetime) -> None:
    order = await db.get(Order, order_id)
    if order is None:
        raise NotFoundError(f"order {order_id} not found")
    session = await db.get(SessionModel, order.session_id)
    if session is not None and session.status != SessionStatus.active:
        raise ConflictError(f"session {order.session_id} is not active")

    db.add(
        AuditLog(
            action="order_remove",
            entity="order",
            entity_id=order_id,
            details={
                "session_id": order.session_id,
                "product_id": order.product_id,
                "qty": order.qty,
                "unit_price": order.unit_price,
            },
            created_at=now,
        )
    )
    await db.execute(delete(Order).where(Order.id == order_id))
    await db.execute(text("NOTIFY hall_changed"))
    await db.commit()
