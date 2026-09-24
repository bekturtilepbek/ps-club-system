from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.clock import now as _now
from core.api.deps import require_auth
from core.api.schemas.hall import HallSnapshotResponse, hall_snapshot_to_response
from core.db.session import get_session
from core.services import hall as hall_service

router = APIRouter(prefix="/hall", tags=["hall"], dependencies=[Depends(require_auth)])


@router.get("", response_model=HallSnapshotResponse)
async def get_hall(db: AsyncSession = Depends(get_session)) -> HallSnapshotResponse:  # noqa: B008
    snapshot = await hall_service.build_hall_snapshot(db, _now())
    return hall_snapshot_to_response(snapshot)
