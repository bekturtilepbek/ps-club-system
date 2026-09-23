from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.clock import now as _now
from core.api.schemas.payments import PaymentRequest, PaymentResponse
from core.api.schemas.sessions import (
    SegmentResponse,
    SessionExtendRequest,
    SessionResponse,
    SessionStartRequest,
)
from core.db.models import Session as SessionModel
from core.db.session import get_session
from core.services import payments as payments_service
from core.services import sessions as sessions_service
from core.services.errors import NotFoundError

router = APIRouter(prefix="/sessions", tags=["sessions"])


async def _to_response(db: AsyncSession, session: SessionModel, now: datetime) -> SessionResponse:
    charge = await payments_service.session_charge_total(db, session.id, now)
    paid = await payments_service.session_paid_total(db, session.id)
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
        segments=[SegmentResponse.model_validate(s) for s in session.segments],
        charge_total=charge,
        paid_total=paid,
        balance=charge - paid,
    )


@router.post("", response_model=SessionResponse)
async def start(body: SessionStartRequest, db: AsyncSession = Depends(get_session)):  # noqa: B008
    now = _now()
    session = await sessions_service.start_session(
        db,
        console_id=body.console_id,
        kind=body.kind,
        tariff_id=body.tariff_id,
        reason=body.reason,
        comment=body.comment,
        now=now,
    )
    return await _to_response(db, session, now)


@router.get("/{session_id}", response_model=SessionResponse)
async def get(session_id: int, db: AsyncSession = Depends(get_session)):  # noqa: B008
    now = _now()
    session = await db.get(SessionModel, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")
    return await _to_response(db, session, now)


@router.post("/{session_id}/extend", response_model=SessionResponse)
async def extend(
    session_id: int,
    body: SessionExtendRequest,
    db: AsyncSession = Depends(get_session),  # noqa: B008
):
    now = _now()
    session = await sessions_service.extend_session(
        db, session_id=session_id, tariff_id=body.tariff_id, now=now
    )
    return await _to_response(db, session, now)


@router.post("/{session_id}/stop", response_model=SessionResponse)
async def stop(session_id: int, db: AsyncSession = Depends(get_session)):  # noqa: B008
    now = _now()
    session = await sessions_service.stop_session(db, session_id=session_id, now=now)
    return await _to_response(db, session, now)


@router.post("/{session_id}/cancel", response_model=SessionResponse)
async def cancel(session_id: int, db: AsyncSession = Depends(get_session)):  # noqa: B008
    now = _now()
    session = await sessions_service.cancel_session(db, session_id=session_id, now=now)
    return await _to_response(db, session, now)


@router.post("/{session_id}/payments", response_model=PaymentResponse)
async def pay(session_id: int, body: PaymentRequest, db: AsyncSession = Depends(get_session)):  # noqa: B008
    now = _now()
    return await payments_service.add_payment(
        db,
        session_id=session_id,
        amount=body.amount,
        method=body.method,
        now=now,
    )
