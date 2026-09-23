from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import Payment, PaymentMethod, SessionKind
from core.db.models import Session as SessionModel
from core.domain import money
from core.services import business_days
from core.services.errors import ConflictError, NotFoundError, ValidationError


async def session_charge_total(db: AsyncSession, session_id: int, now: datetime) -> int:
    session = await db.get(SessionModel, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")

    if session.kind != SessionKind.paid:
        return 0  # free and service sessions never have a charge

    total = 0
    for segment in session.segments:
        if segment.amount is not None:
            total += segment.amount
        elif segment.ends_at is None:
            elapsed = (now - segment.starts_at).total_seconds()
            total += money.open_time_amount(elapsed, segment.price_snapshot)
    return total


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
    await db.commit()
    await db.refresh(payment)
    return payment
