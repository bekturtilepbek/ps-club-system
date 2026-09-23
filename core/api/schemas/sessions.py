from datetime import datetime

from pydantic import BaseModel, ConfigDict

from core.db.models import SegmentKind, SessionKind, SessionStatus


class SessionStartRequest(BaseModel):
    console_id: int
    kind: SessionKind = SessionKind.paid
    tariff_id: int | None = None
    reason: str | None = None
    comment: str | None = None


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
    grace_until: datetime
    ended_at: datetime | None
    comment: str | None
    segments: list[SegmentResponse]
    charge_total: int
    paid_total: int
    balance: int
