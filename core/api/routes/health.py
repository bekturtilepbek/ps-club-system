from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.db.session import get_session
from core.services import health as health_service

router = APIRouter()


class HealthResponse(BaseModel):
    status: str
    db: bool
    worker: bool
    backup: bool
    worker_last_beat_at: datetime | None
    last_backup_at: datetime | None


@router.get("/health", response_model=HealthResponse)
async def health(
    response: Response,
    db: AsyncSession = Depends(get_session),  # noqa: B008
) -> HealthResponse:
    """200 while the API can serve (even "degraded": worker or backups are stale, see the
    flags); 503 only when the database is unreachable."""
    report = await health_service.check(
        db,
        now=datetime.now(ZoneInfo(settings.timezone)),
        backup_dir=Path(settings.backup_dir),
    )
    if report.status == "down":
        response.status_code = 503
    return HealthResponse(**report.__dict__)
