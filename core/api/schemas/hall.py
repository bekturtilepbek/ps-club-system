from datetime import datetime

from pydantic import BaseModel

from core.api.schemas.sessions import SessionResponse, build_session_response
from core.services.hall import HallSnapshot


class HallConsoleResponse(BaseModel):
    id: int
    zone_id: int
    name: str
    is_active: bool
    session: SessionResponse | None
    charge_total: int
    paid_total: int
    balance: int


class HallSnapshotResponse(BaseModel):
    generated_at: datetime
    business_day_open: bool
    consoles: list[HallConsoleResponse]
    tickets: list[SessionResponse]


def hall_snapshot_to_response(snapshot: HallSnapshot) -> HallSnapshotResponse:
    consoles = []
    for view in snapshot.consoles:
        session_response = None
        if view.session is not None:
            session_response = build_session_response(
                view.session, charge_total=view.charge_total, paid_total=view.paid_total
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
    tickets = [
        build_session_response(t.session, charge_total=t.charge_total, paid_total=t.paid_total)
        for t in snapshot.tickets
    ]
    return HallSnapshotResponse(
        generated_at=snapshot.generated_at,
        business_day_open=snapshot.business_day_open,
        consoles=consoles,
        tickets=tickets,
    )
