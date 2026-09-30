import enum
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import (
    BusinessDay,
    Console,
    Order,
    Payment,
    PaymentMethod,
    Product,
    SegmentKind,
    SessionKind,
    SessionSegment,
    SessionStatus,
    Tariff,
)
from core.db.models import Session as SessionModel
from core.services.errors import NotFoundError


class FeedKind(str, enum.Enum):
    session_started = "session_started"
    session_extended = "session_extended"
    session_finished = "session_finished"
    session_cancelled = "session_cancelled"
    payment = "payment"
    order = "order"


@dataclass(frozen=True)
class FeedEvent:
    at: datetime
    kind: FeedKind
    session_id: int
    console_name: str | None  # None for a walk-in ticket
    session_kind: SessionKind
    segment_kind: SegmentKind | None = None
    tariff_name: str | None = None
    reason: str | None = None
    product_name: str | None = None
    qty: int | None = None
    amount: int | None = None
    method: PaymentMethod | None = None
    minutes: int | None = None


async def day_feed(db: AsyncSession, *, business_day_id: int, limit: int = 200) -> list[FeedEvent]:
    """The day's events, newest first: the digital version of the paper notebook.
    Built from rows that already carry timestamps; nothing is stored twice."""
    day = await db.get(BusinessDay, business_day_id)
    if day is None:
        raise NotFoundError(f"business day {business_day_id} not found")

    def within_day(column):
        if day.closed_at is None:
            return column >= day.opened_at
        return and_(column >= day.opened_at, column <= day.closed_at)

    console_names = {c.id: c.name for c in (await db.execute(select(Console))).scalars().all()}
    tariff_names = {t.id: t.name for t in (await db.execute(select(Tariff))).scalars().all()}

    def who(session: SessionModel) -> dict:
        return {
            "session_id": session.id,
            "console_name": console_names.get(session.console_id) if session.console_id else None,
            "session_kind": session.kind,
        }

    events: list[FeedEvent] = []

    started = await db.execute(
        select(SessionModel).where(
            SessionModel.business_day_id == day.id, SessionModel.console_id.is_not(None)
        )
    )
    for session in started.scalars().all():
        first = session.segments[0] if session.segments else None
        events.append(
            FeedEvent(
                at=session.started_at,
                kind=FeedKind.session_started,
                segment_kind=first.kind if first else None,
                tariff_name=(
                    tariff_names.get(first.tariff_id) if first and first.tariff_id else None
                ),
                reason=session.reason,
                **who(session),
            )
        )

    ended = await db.execute(select(SessionModel).where(within_day(SessionModel.ended_at)))
    for session in ended.scalars().all():
        events.append(
            FeedEvent(
                at=session.ended_at,
                kind=(
                    FeedKind.session_cancelled
                    if session.status == SessionStatus.cancelled
                    else FeedKind.session_finished
                ),
                minutes=int((session.ended_at - session.started_at).total_seconds() // 60),
                **who(session),
            )
        )

    sold = await db.execute(
        select(SessionSegment, SessionModel)
        .join(SessionModel, SessionSegment.session_id == SessionModel.id)
        .where(within_day(SessionSegment.created_at))
    )
    for segment, session in sold.all():
        if segment.id == min(s.id for s in session.segments):
            continue  # the first segment is the start, already listed
        events.append(
            FeedEvent(
                at=segment.created_at,
                kind=FeedKind.session_extended,
                segment_kind=segment.kind,
                tariff_name=tariff_names.get(segment.tariff_id) if segment.tariff_id else None,
                **who(session),
            )
        )

    payments = await db.execute(
        select(Payment, SessionModel)
        .join(SessionModel, Payment.session_id == SessionModel.id)
        .where(Payment.business_day_id == day.id)
    )
    for payment, session in payments.all():
        events.append(
            FeedEvent(
                at=payment.created_at,
                kind=FeedKind.payment,
                amount=payment.amount,
                method=payment.method,
                **who(session),
            )
        )

    orders = await db.execute(
        select(Order, SessionModel, Product)
        .join(SessionModel, Order.session_id == SessionModel.id)
        .join(Product, Order.product_id == Product.id)
        .where(within_day(Order.created_at))
    )
    for order, session, product in orders.all():
        events.append(
            FeedEvent(
                at=order.created_at,
                kind=FeedKind.order,
                product_name=product.name,
                qty=order.qty,
                amount=order.qty * order.unit_price,
                **who(session),
            )
        )

    events.sort(key=lambda event: event.at, reverse=True)
    return events[:limit]
