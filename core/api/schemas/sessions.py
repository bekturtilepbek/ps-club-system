from datetime import datetime

from pydantic import BaseModel, ConfigDict

from core.api.schemas.bar import OrderResponse
from core.db.models import SegmentKind, SessionKind, SessionStatus
from core.db.models import Session as SessionModel


class SessionStartRequest(BaseModel):
    console_id: int
    kind: SessionKind = SessionKind.paid
    tariff_id: int | None = None
    reason: str | None = None
    comment: str | None = None
    game_id: int | None = None


class SessionExtendRequest(BaseModel):
    tariff_id: int


class SegmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    tariff_id: int | None
    kind: SegmentKind
    starts_at: datetime
    ends_at: datetime | None
    price_snapshot: int
    amount: int | None


class SessionResponse(BaseModel):
    id: int
    console_id: int | None
    business_day_id: int
    kind: SessionKind
    reason: str | None
    status: SessionStatus
    started_at: datetime
    grace_until: datetime | None
    ended_at: datetime | None
    comment: str | None
    game_id: int | None
    game: str | None
    segments: list[SegmentResponse]
    orders: list[OrderResponse]
    charge_total: int
    paid_total: int
    balance: int


def build_session_response(
    session: SessionModel, *, charge_total: int, paid_total: int
) -> SessionResponse:
    """The one place a Session ORM row becomes a SessionResponse — used for a
    plain GET, for every mutation response, and (Task 5) for a hall snapshot's
    console sessions and walk-in tickets alike. Pure: takes charge/paid as
    arguments instead of computing them, so it needs no DB access itself."""
    return SessionResponse(
        id=session.id,
        console_id=session.console_id,
        business_day_id=session.business_day_id,
        kind=session.kind,
        reason=session.reason,
        status=session.status,
        started_at=session.started_at,
        grace_until=session.grace_until,
        ended_at=session.ended_at,
        comment=session.comment,
        game_id=session.game_id,
        game=session.game.name if session.game else None,
        segments=[SegmentResponse.model_validate(s) for s in session.segments],
        orders=[OrderResponse.model_validate(o) for o in session.orders],
        charge_total=charge_total,
        paid_total=paid_total,
        balance=charge_total - paid_total,
    )
