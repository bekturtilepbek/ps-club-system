from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.clock import now as _now
from core.api.deps import require_auth
from core.api.limits import EntityId
from core.api.schemas.bar import OrderRequest, OrderResponse
from core.api.schemas.payments import PaymentRequest, PaymentResponse
from core.api.schemas.sessions import (
    SessionExtendRequest,
    SessionResponse,
    SessionStartRequest,
    build_session_response,
)
from core.db.models import Session as SessionModel
from core.db.session import get_session
from core.services import bar as bar_service
from core.services import payments as payments_service
from core.services import sessions as sessions_service
from core.services.errors import NotFoundError

router = APIRouter(prefix="/sessions", tags=["sessions"], dependencies=[Depends(require_auth)])


async def session_to_response(
    db: AsyncSession, session: SessionModel, now: datetime
) -> SessionResponse:
    charge = await payments_service.session_charge_total(db, session.id, now)
    paid = await payments_service.session_paid_total(db, session.id)
    return build_session_response(session, charge_total=charge, paid_total=paid)


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
        game_id=body.game_id,
        now=now,
    )
    return await session_to_response(db, session, now)


@router.get("/{session_id}", response_model=SessionResponse)
async def get(session_id: EntityId, db: AsyncSession = Depends(get_session)):  # noqa: B008
    now = _now()
    session = await db.get(SessionModel, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")
    return await session_to_response(db, session, now)


@router.post("/{session_id}/extend", response_model=SessionResponse)
async def extend(
    session_id: EntityId,
    body: SessionExtendRequest,
    db: AsyncSession = Depends(get_session),  # noqa: B008
):
    now = _now()
    session = await sessions_service.extend_session(
        db, session_id=session_id, tariff_id=body.tariff_id, now=now
    )
    return await session_to_response(db, session, now)


@router.post("/{session_id}/stop", response_model=SessionResponse)
async def stop(session_id: EntityId, db: AsyncSession = Depends(get_session)):  # noqa: B008
    now = _now()
    session = await sessions_service.stop_session(db, session_id=session_id, now=now)
    return await session_to_response(db, session, now)


@router.post("/{session_id}/cancel", response_model=SessionResponse)
async def cancel(session_id: EntityId, db: AsyncSession = Depends(get_session)):  # noqa: B008
    now = _now()
    session = await sessions_service.cancel_session(db, session_id=session_id, now=now)
    return await session_to_response(db, session, now)


@router.post("/{session_id}/payments", response_model=PaymentResponse)
async def pay(session_id: EntityId, body: PaymentRequest, db: AsyncSession = Depends(get_session)):  # noqa: B008
    now = _now()
    return await payments_service.add_payment(
        db,
        session_id=session_id,
        amount=body.amount,
        method=body.method,
        now=now,
    )


@router.post("/{session_id}/orders", response_model=OrderResponse)
async def add_order(
    session_id: EntityId,
    body: OrderRequest,
    db: AsyncSession = Depends(get_session),  # noqa: B008
):
    now = _now()
    return await bar_service.add_order(
        db, session_id=session_id, product_id=body.product_id, qty=body.qty, now=now
    )
