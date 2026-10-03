import enum
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
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


_PRIORITY = {
    FeedKind.session_started: 0,
    FeedKind.session_extended: 1,
    FeedKind.order: 2,
    FeedKind.payment: 3,
    FeedKind.session_finished: 4,
    FeedKind.session_cancelled: 4,
}


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

    console_names = {c.id: c.name for c in (await db.execute(select(Console))).scalars().all()}
    tariff_names = {t.id: t.name for t in (await db.execute(select(Tariff))).scalars().all()}

    def who(session: SessionModel) -> dict:
        return {
            "session_id": session.id,
            "console_name": console_names.get(session.console_id) if session.console_id else None,
            "session_kind": session.kind,
        }

    events: list[FeedEvent] = []

    # Every event kind belongs to the day of its session (business_day_id), so a session
    # started on day A never leaks into day B's feed, whatever the clock says.
    # Walk-in tickets (console_id NULL) get no "started" event on purpose: a bar-only sale
    # is not a game start. Their orders and payments are still listed, with no console name.
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

    ended = await db.execute(
        select(SessionModel).where(
            SessionModel.business_day_id == day.id, SessionModel.ended_at.is_not(None)
        )
    )
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
        .where(SessionModel.business_day_id == day.id)
    )
    first_segment_id: dict[int, int] = {}
    for segment, session in sold.all():
        if session.id not in first_segment_id:
            first_segment_id[session.id] = min(s.id for s in session.segments)
        if segment.id == first_segment_id[session.id]:
            continue  # the first segment is the start, already listed
        events.append(
            FeedEvent(
                # Rows from before created_at was recorded have NULL there.
                at=segment.created_at or segment.starts_at,
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
        .where(SessionModel.business_day_id == day.id)
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

    # Newest first; at equal timestamps the later step of a session's story comes first
    # (end > payment > order > extension > start), then the higher session id.
    events.sort(key=lambda e: (e.at, _PRIORITY[e.kind], e.session_id), reverse=True)
    return events[:limit]
