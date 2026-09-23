from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.schemas.business_days import (
    BusinessDayCloseRequest,
    BusinessDayOpenRequest,
    BusinessDayResponse,
)
from core.config import settings
from core.db.session import get_session
from core.services import business_days
from core.services.errors import NotFoundError

router = APIRouter(prefix="/business-days", tags=["business-days"])


def _now() -> datetime:
    return datetime.now(ZoneInfo(settings.timezone))


@router.post("/open", response_model=BusinessDayResponse)
async def open_day(body: BusinessDayOpenRequest, db: AsyncSession = Depends(get_session)):  # noqa: B008
    return await business_days.open_business_day(db, opening_cash=body.opening_cash, now=_now())


@router.get("/current", response_model=BusinessDayResponse)
async def current_day(db: AsyncSession = Depends(get_session)):  # noqa: B008
    day = await business_days.get_open_business_day(db)
    if day is None:
        raise NotFoundError("no open business day")
    return day


@router.post("/{business_day_id}/close", response_model=BusinessDayResponse)
async def close_day(
    business_day_id: int,
    body: BusinessDayCloseRequest,
    db: AsyncSession = Depends(get_session),  # noqa: B008
):
    return await business_days.close_business_day(
        db,
        business_day_id=business_day_id,
        counted_cash=body.counted_cash,
        now=_now(),
    )
