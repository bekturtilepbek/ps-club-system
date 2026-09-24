from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.clock import now as _now
from core.api.deps import require_auth
from core.api.routes.sessions import session_to_response
from core.api.schemas.sessions import SessionResponse
from core.db.session import get_session
from core.services import sessions as sessions_service

router = APIRouter(prefix="/tickets", tags=["tickets"], dependencies=[Depends(require_auth)])


@router.post("", response_model=SessionResponse)
async def open_ticket(db: AsyncSession = Depends(get_session)):  # noqa: B008
    now = _now()
    session = await sessions_service.open_ticket(db, now=now)
    return await session_to_response(db, session, now)
