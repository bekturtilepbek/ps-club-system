from datetime import datetime

from pydantic import BaseModel, ConfigDict

from core.db.models import PaymentMethod, SegmentKind, SessionKind
from core.services.feed import FeedKind


class FeedEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    at: datetime
    kind: FeedKind
    session_id: int
    console_name: str | None
    session_kind: SessionKind
    segment_kind: SegmentKind | None
    tariff_name: str | None
    reason: str | None
    product_name: str | None
    qty: int | None
    amount: int | None
    method: PaymentMethod | None
    minutes: int | None
