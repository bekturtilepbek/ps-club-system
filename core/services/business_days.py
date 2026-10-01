from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.db.models import BusinessDay, Payment, PaymentMethod, SessionKind, SessionStatus
from core.db.models import Session as SessionModel
from core.domain.planned_close import next_planned_close_at
from core.services import settings as settings_service
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
    transfer_total: int
    expected_cash: int
    sessions_count: int
    minutes_total: int
    free_minutes_total: int
    bar_sales_total: int
    has_active_sessions: bool


async def summaries_for_days(
    db: AsyncSession, *, days: list[BusinessDay], now: datetime
) -> dict[int, DaySummary]:
    """Summaries for several days in a fixed number of queries: the history list shows
    every day's totals, and one day_summary() per row would be one round-trip per day."""
    if not days:
        return {}
    day_ids = [day.id for day in days]

    payments_result = await db.execute(
        select(Payment.business_day_id, Payment.method, Payment.amount).where(
            Payment.business_day_id.in_(day_ids)
        )
    )
    paid: dict[int, dict[PaymentMethod, int]] = {
        day_id: {method: 0 for method in PaymentMethod} for day_id in day_ids
    }
    for day_id, method, amount in payments_result.all():
        paid[day_id][method] += amount

    sessions_result = await db.execute(
        select(SessionModel).where(
            SessionModel.business_day_id.in_(day_ids),
            SessionModel.status != SessionStatus.cancelled,
        )
    )
    # Session.segments and Session.orders are lazy="selectin" (core/db/models/sessions.py):
    # they are loaded in bulk with this query, not one per session.
    sessions_by_day: dict[int, list[SessionModel]] = {day_id: [] for day_id in day_ids}
    for session in sessions_result.scalars().all():
        sessions_by_day[session.business_day_id].append(session)

    summaries: dict[int, DaySummary] = {}
    for day in days:
        minutes_total = free_minutes_total = bar_sales_total = 0
        has_active = False
        for session in sessions_by_day[day.id]:
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

        cash_total = paid[day.id][PaymentMethod.cash]
        summaries[day.id] = DaySummary(
            opening_cash=day.opening_cash,
            cash_total=cash_total,
            transfer_total=paid[day.id][PaymentMethod.transfer],
            expected_cash=day.opening_cash + cash_total,
            sessions_count=len(sessions_by_day[day.id]),
            minutes_total=minutes_total,
            free_minutes_total=free_minutes_total,
            bar_sales_total=bar_sales_total,
            has_active_sessions=has_active,
        )
    return summaries


async def day_summary(db: AsyncSession, *, business_day_id: int, now: datetime) -> DaySummary:
    day = await db.get(BusinessDay, business_day_id)
    if day is None:
        raise NotFoundError(f"business day {business_day_id} not found")
    return (await summaries_for_days(db, days=[day], now=now))[day.id]


async def list_business_days(db: AsyncSession, *, limit: int = 30) -> list[BusinessDay]:
    result = await db.execute(
        select(BusinessDay).order_by(BusinessDay.opened_at.desc()).limit(limit)
    )
    return list(result.scalars().all())


async def claim_unclosed_day_reminder(db: AsyncSession, *, now: datetime) -> BusinessDay | None:
    """Returns the open day exactly when an unclosed-day reminder is due, and
    records `now` onto it in the same transaction — so a re-run (e.g. two worker
    ticks close together) never double-sends. SPEC.md §3.6: never auto-closes,
    only reminds; CLAUDE.md: background jobs must be idempotent via a DB record."""
    day = await get_open_business_day(db)
    if day is None:
        return None

    planned_close = await settings_service.get_planned_close(db)
    threshold_minutes = await settings_service.get_day_reminder_threshold_minutes(db)
    interval_minutes = await settings_service.get_day_reminder_interval_minutes(db)

    # day.opened_at, loaded from a TIMESTAMP(timezone=True) column, round-trips
    # through Postgres/asyncpg tagged UTC even when it was written as Bishkek-aware
    # (same instant, different tzinfo). next_planned_close_at anchors on wall-clock
    # hour/minute, so it must be given the Bishkek-local reading, not the raw UTC one.
    anchor = day.opened_at.astimezone(ZoneInfo(settings.timezone))
    due_at = next_planned_close_at(anchor, planned_close) + timedelta(minutes=threshold_minutes)
    if now < due_at:
        return None
    if day.last_reminder_at is not None and now < day.last_reminder_at + timedelta(
        minutes=interval_minutes
    ):
        return None

    day.last_reminder_at = now
    await db.commit()
    await db.refresh(day)
    return day
