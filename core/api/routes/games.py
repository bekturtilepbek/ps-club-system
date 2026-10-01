from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.deps import require_auth
from core.api.schemas.games import GameResponse
from core.db.session import get_session
from core.services import games as games_service

router = APIRouter(prefix="/games", tags=["games"], dependencies=[Depends(require_auth)])


@router.get("", response_model=list[GameResponse])
async def list_games(db: AsyncSession = Depends(get_session)):  # noqa: B008
    return await games_service.list_active_games(db)
