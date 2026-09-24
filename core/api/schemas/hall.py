from datetime import datetime

from pydantic import BaseModel

from core.api.schemas.sessions import SegmentResponse
from core.db.models import SessionKind, SessionStatus
from core.services.hall import HallSnapshot


class HallSessionResponse(BaseModel):
    id: int
    kind: SessionKind
    reason: str | None
    status: SessionStatus
    started_at: datetime
    grace_until: datetime
    segments: list[SegmentResponse]


class HallConsoleResponse(BaseModel):
    id: int
    zone_id: int
    name: str
    is_active: bool
    session: HallSessionResponse | None
    charge_total: int
    paid_total: int
    balance: int


class HallSnapshotResponse(BaseModel):
    generated_at: datetime
    business_day_open: bool
    consoles: list[HallConsoleResponse]


def hall_snapshot_to_response(snapshot: HallSnapshot) -> HallSnapshotResponse:
    consoles = []
    for view in snapshot.consoles:
        session_response = None
        if view.session is not None:
            session_response = HallSessionResponse(
                id=view.session.id,
                kind=view.session.kind,
                reason=view.session.reason,
                status=view.session.status,
                started_at=view.session.started_at,
                grace_until=view.session.grace_until,
                segments=[SegmentResponse.model_validate(s) for s in view.session.segments],
            )
        consoles.append(
            HallConsoleResponse(
                id=view.id,
                zone_id=view.zone_id,
                name=view.name,
                is_active=view.is_active,
                session=session_response,
                charge_total=view.charge_total,
                paid_total=view.paid_total,
                balance=view.balance,
            )
        )
    return HallSnapshotResponse(
        generated_at=snapshot.generated_at,
        business_day_open=snapshot.business_day_open,
        consoles=consoles,
    )
