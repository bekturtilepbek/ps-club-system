from datetime import datetime

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import BusinessDay, Payment, PaymentMethod, SessionStatus
from core.db.models import Session as SessionModel
from core.services.errors import ConflictError, NotFoundError


async def get_open_business_day(db: AsyncSession) -> BusinessDay | None:
    result = await db.execute(select(BusinessDay).where(BusinessDay.closed_at.is_(None)))
    return result.scalar_one_or_none()


async def open_business_day(db: AsyncSession, *, opening_cash: int, now: datetime) -> BusinessDay:
    if await get_open_business_day(db) is not None:
        raise ConflictError("business day already open")

    day = BusinessDay(opened_at=now, opening_cash=opening_cash)
    db.add(day)
    try:
        await db.execute(text("NOTIFY hall_changed"))
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if "ux_business_days_one_open" not in str(exc.orig):
            raise
        raise ConflictError("business day already open") from None
    await db.refresh(day)
    return day


async def close_business_day(
    db: AsyncSession, *, business_day_id: int, counted_cash: int, now: datetime
) -> BusinessDay:
    day = await db.get(BusinessDay, business_day_id)
    if day is None:
        raise NotFoundError(f"business day {business_day_id} not found")
    if day.closed_at is not None:
        raise ConflictError("business day already closed")

    active = await db.execute(
        select(SessionModel).where(
            SessionModel.business_day_id == business_day_id,
            SessionModel.status == SessionStatus.active,
        )
    )
    if active.scalars().first() is not None:
        raise ConflictError("business day has active sessions, finish them first")

    cash_result = await db.execute(
        select(Payment.amount).where(
            Payment.business_day_id == business_day_id,
            Payment.method == PaymentMethod.cash,
        )
    )
    cash_total = sum(cash_result.scalars().all())

    day.closed_at = now
    day.expected_cash = day.opening_cash + cash_total
    day.counted_cash = counted_cash
    await db.execute(text("NOTIFY hall_changed"))
    await db.commit()
    await db.refresh(day)
    return day
