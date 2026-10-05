"""Read-only analytics over the business days, sessions, payments and bar orders.

Revenue is grouped by business day (the local date the day was opened on); load is spread over
real clock hours. See docs/superpowers/specs/2026-10-05-stage-11-analytics-design.md."""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.db.models import (
    BusinessDay,
    Console,
    Order,
    Payment,
    PaymentMethod,
    Product,
    SessionKind,
    SessionStatus,
)
from core.db.models import Session as SessionModel
from core.domain import analytics as domain

BAR_ROWS_LIMIT = 20


def _tz() -> ZoneInfo:
    return ZoneInfo(settings.timezone)


@dataclass(frozen=True)
class PeriodTotals:
    cash_total: int
    transfer_total: int
    paid_sessions_count: int
    avg_check: int | None
    bar_per_session: int | None
    free_minutes: int
    service_minutes: int
    bar_sales_total: int

    @property
    def revenue_total(self) -> int:
        return self.cash_total + self.transfer_total


@dataclass(frozen=True)
class SummaryResult:
    date_from: date
    date_to: date
    includes_open_day: bool
    current: PeriodTotals
    previous: PeriodTotals
    changes: dict[str, float | None]


@dataclass(frozen=True)
class RevenuePoint:
    period_start: date
    cash_total: int
    transfer_total: int


@dataclass(frozen=True)
class LoadResult:
    date_from: date
    date_to: date
    consoles_count: int
    cells: list[domain.LoadCell]
    hourly: list[tuple[int, float]]
    quietest: domain.LoadCell | None
    busiest: domain.LoadCell | None


@dataclass(frozen=True)
class BarRow:
    name: str
    qty: int
    revenue: int


@dataclass(frozen=True)
class GameRow:
    name: str | None
    sessions: int
    revenue: int


async def first_business_date(db: AsyncSession) -> date | None:
    """Local date of the earliest business day, None while there is none."""
    earliest = (await db.execute(select(func.min(BusinessDay.opened_at)))).scalar_one()
    if earliest is None:
        return None
    # Postgres returns timestamptz tagged UTC: read the date on the club's clock.
    return earliest.astimezone(_tz()).date()


async def resolve_range(
    db: AsyncSession, *, date_from: date, date_to: date, today: date
) -> tuple[date, date]:
    """Clamp the requested range to [first business day, today]; an empty result collapses to one
    day. This is what makes "all time" a request with a very early `from`."""
    first_date = await first_business_date(db)
    effective_to = min(date_to, today)
    if first_date is None:
        # No business day yet: there is nothing to span, collapse to a single day.
        return effective_to, effective_to
    effective_from = max(date_from, first_date)
    if effective_from > effective_to:
        effective_from = effective_to
    return effective_from, effective_to


async def _days_in_range(db: AsyncSession, date_from: date, date_to: date) -> list[BusinessDay]:
    tz = _tz()
    start = datetime.combine(date_from, time.min, tzinfo=tz)
    end = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=tz)
    result = await db.execute(
        select(BusinessDay)
        .where(BusinessDay.opened_at >= start, BusinessDay.opened_at < end)
        .order_by(BusinessDay.opened_at)
    )
    return list(result.scalars().all())


async def _sessions(db: AsyncSession, day_ids: list[int]) -> list[SessionModel]:
    if not day_ids:
        return []
    result = await db.execute(
        select(SessionModel).where(
            SessionModel.business_day_id.in_(day_ids),
            SessionModel.status != SessionStatus.cancelled,
        )
    )
    # segments, orders and game are lazy="selectin": loaded in bulk, not per session.
    return list(result.scalars().all())


def _game_amount(session: SessionModel) -> int:
    return sum(segment.amount or 0 for segment in session.segments)


def _intervals(session: SessionModel, now: datetime) -> list[domain.Interval]:
    return domain.effective_intervals(
        [(segment.starts_at, segment.ends_at) for segment in session.segments],
        ended_at=session.ended_at,
        now=now,
    )


def _is_paid_visit(session: SessionModel) -> bool:
    return session.kind == SessionKind.paid and session.console_id is not None


async def _period_totals(db: AsyncSession, days: list[BusinessDay], now: datetime) -> PeriodTotals:
    day_ids = [day.id for day in days]
    paid = {method: 0 for method in PaymentMethod}
    if day_ids:
        rows = await db.execute(
            select(Payment.method, func.sum(Payment.amount))
            .where(Payment.business_day_id.in_(day_ids))
            .group_by(Payment.method)
        )
        for method, total in rows.all():
            paid[method] = int(total)

    paid_count = finished_count = game_total = 0
    bar_total = bar_on_visits = visits_with_bar = 0
    free_minutes = service_minutes = 0
    for session in await _sessions(db, day_ids):
        minutes = domain.interval_minutes(_intervals(session, now))
        if session.kind == SessionKind.service:
            service_minutes += minutes
        elif session.kind == SessionKind.free:
            free_minutes += minutes
        session_bar = sum(order.qty * order.unit_price for order in session.orders)
        bar_total += session_bar
        if _is_paid_visit(session):
            paid_count += 1
            if session.orders:
                visits_with_bar += 1
                bar_on_visits += session_bar
            if session.status == SessionStatus.finished:
                finished_count += 1
                game_total += _game_amount(session)

    return PeriodTotals(
        cash_total=paid[PaymentMethod.cash],
        transfer_total=paid[PaymentMethod.transfer],
        paid_sessions_count=paid_count,
        avg_check=domain.average(game_total, finished_count),
        bar_per_session=domain.average(bar_on_visits, visits_with_bar),
        free_minutes=free_minutes,
        service_minutes=service_minutes,
        bar_sales_total=bar_total,
    )


async def summary(
    db: AsyncSession, *, date_from: date, date_to: date, today: date, now: datetime
) -> SummaryResult:
    date_from, date_to = await resolve_range(db, date_from=date_from, date_to=date_to, today=today)
    days = await _days_in_range(db, date_from, date_to)
    current = await _period_totals(db, days, now)

    prev_from, prev_to = domain.previous_period(date_from, date_to)
    previous = await _period_totals(db, await _days_in_range(db, prev_from, prev_to), now)

    # A previous period reaching back before the first business day covers fewer real days, so
    # any percent against it would be inflated: show no comparison at all.
    first_date = await first_business_date(db)
    comparable = first_date is not None and prev_from >= first_date

    changes = {
        "revenue_total": domain.change_percent(current.revenue_total, previous.revenue_total),
        "paid_sessions_count": domain.change_percent(
            current.paid_sessions_count, previous.paid_sessions_count
        ),
        "avg_check": domain.change_percent(current.avg_check, previous.avg_check),
        "bar_per_session": domain.change_percent(current.bar_per_session, previous.bar_per_session),
        "free_minutes": domain.change_percent(current.free_minutes, previous.free_minutes),
        "bar_sales_total": domain.change_percent(current.bar_sales_total, previous.bar_sales_total),
    }
    if not comparable:
        changes = dict.fromkeys(changes)
    return SummaryResult(
        date_from=date_from,
        date_to=date_to,
        includes_open_day=any(day.closed_at is None for day in days),
        current=current,
        previous=previous,
        changes=changes,
    )


async def revenue_series(
    db: AsyncSession, *, date_from: date, date_to: date, group: domain.Group, today: date
) -> tuple[date, date, list[RevenuePoint]]:
    date_from, date_to = await resolve_range(db, date_from=date_from, date_to=date_to, today=today)
    days = await _days_in_range(db, date_from, date_to)
    tz = _tz()
    bucket_of_day = {
        day.id: domain.bucket_start(day.opened_at.astimezone(tz).date(), group) for day in days
    }

    cash = {start: 0 for start in domain.bucket_starts(date_from, date_to, group)}
    transfer = dict(cash)
    if days:
        rows = await db.execute(
            select(Payment.business_day_id, Payment.method, func.sum(Payment.amount))
            .where(Payment.business_day_id.in_(list(bucket_of_day)))
            .group_by(Payment.business_day_id, Payment.method)
        )
        for day_id, method, total in rows.all():
            target = cash if method == PaymentMethod.cash else transfer
            target[bucket_of_day[day_id]] += int(total)

    points = [
        RevenuePoint(period_start=start, cash_total=cash[start], transfer_total=transfer[start])
        for start in sorted(cash)
    ]
    return date_from, date_to, points


async def load(
    db: AsyncSession, *, date_from: date, date_to: date, today: date, now: datetime
) -> LoadResult:
    date_from, date_to = await resolve_range(db, date_from=date_from, date_to=date_to, today=today)
    days = await _days_in_range(db, date_from, date_to)
    consoles_count = (
        await db.execute(select(func.count()).select_from(Console).where(Console.is_active))
    ).scalar_one()

    slots: domain.Slots = {}
    tz = _tz()
    for session in await _sessions(db, [day.id for day in days]):
        # Maintenance is not guests; a ticket without a console is not a console in use.
        if session.kind == SessionKind.service or session.console_id is None:
            continue
        for start, end in _intervals(session, now):
            domain.add_to_slots(slots, start, end, tz)

    capacity = domain.slot_capacity(date_from, date_to, now, tz)
    cells = domain.build_load_cells(slots, capacity, consoles_count)
    quietest, busiest = domain.quietest_and_busiest(cells)
    return LoadResult(
        date_from=date_from,
        date_to=date_to,
        consoles_count=consoles_count,
        cells=cells,
        hourly=domain.hourly_load(slots, capacity, consoles_count),
        quietest=quietest,
        busiest=busiest,
    )


async def bar_sales(
    db: AsyncSession, *, date_from: date, date_to: date, today: date
) -> tuple[date, date, list[BarRow]]:
    date_from, date_to = await resolve_range(db, date_from=date_from, date_to=date_to, today=today)
    day_ids = [day.id for day in await _days_in_range(db, date_from, date_to)]
    if not day_ids:
        return date_from, date_to, []
    qty = func.sum(Order.qty)
    revenue = func.sum(Order.qty * Order.unit_price)
    rows = await db.execute(
        select(Product.name, qty, revenue)
        .join(Order, Order.product_id == Product.id)
        .join(SessionModel, SessionModel.id == Order.session_id)
        .where(
            SessionModel.business_day_id.in_(day_ids),
            SessionModel.status != SessionStatus.cancelled,
        )
        .group_by(Product.id, Product.name)
        .order_by(revenue.desc(), Product.name)
        .limit(BAR_ROWS_LIMIT)
    )
    return (
        date_from,
        date_to,
        [BarRow(name=n, qty=int(q), revenue=int(r)) for n, q, r in rows.all()],
    )


async def games_ranking(
    db: AsyncSession, *, date_from: date, date_to: date, today: date
) -> tuple[date, date, list[GameRow]]:
    date_from, date_to = await resolve_range(db, date_from=date_from, date_to=date_to, today=today)
    days = await _days_in_range(db, date_from, date_to)
    sessions: dict[str | None, int] = {}
    revenue: dict[str | None, int] = {}
    for session in await _sessions(db, [day.id for day in days]):
        if session.kind == SessionKind.service or session.console_id is None:
            continue
        name = session.game.name if session.game is not None else None
        sessions[name] = sessions.get(name, 0) + 1
        if session.status == SessionStatus.finished:
            revenue[name] = revenue.get(name, 0) + _game_amount(session)
    rows = [GameRow(name=n, sessions=c, revenue=revenue.get(n, 0)) for n, c in sessions.items()]
    # "No game chosen" always sorts last among equals, named games by popularity.
    rows.sort(key=lambda row: (-row.sessions, row.name is None, row.name or ""))
    return date_from, date_to, rows
