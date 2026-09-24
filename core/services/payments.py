from datetime import datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import Payment, PaymentMethod, SessionKind
from core.db.models import Session as SessionModel
from core.domain import money
from core.services import bar as bar_service
from core.services import business_days
from core.services.errors import ConflictError, NotFoundError, ValidationError


async def session_charge_total(db: AsyncSession, session_id: int, now: datetime) -> int:
    session = await db.get(SessionModel, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")

    # Game time is free/waived on a non-paid session; bar orders never are — a
    # friend of the owner still pays for their own Cola (confirmed with the
    # project owner during Stage 4 planning).
    time_total = 0
    if session.kind == SessionKind.paid:
        for segment in session.segments:
            if segment.amount is not None:
                time_total += segment.amount
            elif segment.ends_at is None:
                elapsed = (now - segment.starts_at).total_seconds()
                time_total += money.open_time_amount(elapsed, segment.price_snapshot)

    orders_total = await bar_service.session_orders_total(db, session_id)
    return time_total + orders_total


async def session_paid_total(db: AsyncSession, session_id: int) -> int:
    result = await db.execute(select(Payment.amount).where(Payment.session_id == session_id))
    return sum(result.scalars().all())


async def session_balance(db: AsyncSession, session_id: int, now: datetime) -> int:
    charge = await session_charge_total(db, session_id, now)
    paid = await session_paid_total(db, session_id)
    return charge - paid


async def add_payment(
    db: AsyncSession, *, session_id: int, amount: int, method: PaymentMethod, now: datetime
) -> Payment:
    session = await db.get(SessionModel, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")
    if amount <= 0:
        raise ValidationError("payment amount must be positive")

    day = await business_days.get_open_business_day(db)
    if day is None:
        raise ConflictError("no open business day")

    payment = Payment(
        session_id=session_id,
        business_day_id=day.id,
        amount=amount,
        method=method,
        created_at=now,
    )
    db.add(payment)
    await db.execute(text("NOTIFY hall_changed"))
    await db.commit()
    await db.refresh(payment)
    return payment
