from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.clock import now as _now
from core.api.deps import require_auth
from core.api.schemas.business_days import (
    BusinessDayCloseRequest,
    BusinessDayOpenRequest,
    BusinessDayResponse,
    BusinessDaySummaryResponse,
)
from core.db.session import get_session
from core.services import business_days
from core.services.errors import NotFoundError

router = APIRouter(
    prefix="/business-days", tags=["business-days"], dependencies=[Depends(require_auth)]
)


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


@router.get("/{business_day_id}/summary", response_model=BusinessDaySummaryResponse)
async def business_day_summary(
    business_day_id: int, db: AsyncSession = Depends(get_session)  # noqa: B008
):
    return await business_days.day_summary(db, business_day_id=business_day_id, now=_now())


@router.get("", response_model=list[BusinessDayResponse])
async def list_days(
    limit: int = Query(30, ge=1, le=365), db: AsyncSession = Depends(get_session)  # noqa: B008
):
    return await business_days.list_business_days(db, limit=limit)
