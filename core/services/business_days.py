from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import BusinessDay, Payment, PaymentMethod, SessionKind, SessionStatus
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


@dataclass(frozen=True)
class DaySummary:
    opening_cash: int
    cash_total: int
    qr_total: int
    transfer_total: int
    expected_cash: int
    sessions_count: int
    minutes_total: int
    free_minutes_total: int
    bar_sales_total: int
    has_active_sessions: bool


async def day_summary(db: AsyncSession, *, business_day_id: int, now: datetime) -> DaySummary:
    day = await db.get(BusinessDay, business_day_id)
    if day is None:
        raise NotFoundError(f"business day {business_day_id} not found")

    payments_result = await db.execute(
        select(Payment.method, Payment.amount).where(Payment.business_day_id == business_day_id)
    )
    cash_total = qr_total = transfer_total = 0
    for method, amount in payments_result.all():
        if method == PaymentMethod.cash:
            cash_total += amount
        elif method == PaymentMethod.qr:
            qr_total += amount
        elif method == PaymentMethod.transfer:
            transfer_total += amount

    sessions_result = await db.execute(
        select(SessionModel).where(
            SessionModel.business_day_id == business_day_id,
            SessionModel.status != SessionStatus.cancelled,
        )
    )
    # Session.segments and Session.orders are lazy="selectin" (see core/db/models/sessions.py),
    # so accessing them below on these ORM rows needs no extra eager-load option here.
    sessions = sessions_result.scalars().all()

    minutes_total = 0
    free_minutes_total = 0
    bar_sales_total = 0
    has_active = False
    for session in sessions:
        if session.status == SessionStatus.active:
            has_active = True
        session_minutes = 0
        for segment in session.segments:
            end = segment.ends_at or now
            session_minutes += int((end - segment.starts_at).total_seconds() // 60)
        minutes_total += session_minutes
        if session.kind != SessionKind.paid:
            free_minutes_total += session_minutes
        for order in session.orders:
            bar_sales_total += order.qty * order.unit_price

    return DaySummary(
        opening_cash=day.opening_cash,
        cash_total=cash_total,
        qr_total=qr_total,
        transfer_total=transfer_total,
        expected_cash=day.opening_cash + cash_total,
        sessions_count=len(sessions),
        minutes_total=minutes_total,
        free_minutes_total=free_minutes_total,
        bar_sales_total=bar_sales_total,
        has_active_sessions=has_active,
    )


async def list_business_days(db: AsyncSession, *, limit: int = 30) -> list[BusinessDay]:
    result = await db.execute(
        select(BusinessDay).order_by(BusinessDay.opened_at.desc()).limit(limit)
    )
    return list(result.scalars().all())
