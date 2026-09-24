from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.schemas.settings import PublicSettingsResponse
from core.db.session import get_session
from core.services import settings as settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=PublicSettingsResponse)
async def get_public_settings(db: AsyncSession = Depends(get_session)) -> PublicSettingsResponse:  # noqa: B008
    return PublicSettingsResponse(
        grace_minutes=await settings_service.get_grace_minutes(db),
        warn_minutes=await settings_service.get_warn_minutes(db),
    )
