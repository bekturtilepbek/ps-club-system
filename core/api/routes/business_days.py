import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from core import telegram
from core.api.clock import now as _now
from core.api.deps import require_auth
from core.api.schemas.business_days import (
    BusinessDayCloseRequest,
    BusinessDayHistoryItem,
    BusinessDayOpenRequest,
    BusinessDayResponse,
    BusinessDaySummaryResponse,
)
from core.api.schemas.feed import FeedEventResponse
from core.db.models import BusinessDay
from core.db.session import get_session
from core.services import business_days
from core.services import feed as feed_service
from core.services import settings as settings_service
from core.services.errors import NotFoundError
from core.telegram_messages import format_day_summary

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/business-days", tags=["business-days"], dependencies=[Depends(require_auth)]
)


async def notify_day_closed(db: AsyncSession, day: BusinessDay) -> None:
    """Best-effort: a Telegram outage must never turn a successful close into a
    failed HTTP request for the operator standing at the till."""
    try:
        owner_chat_id = await settings_service.get_owner_chat_id(db)
        if owner_chat_id is None:
            return
        summary = await business_days.day_summary(db, business_day_id=day.id, now=_now())
        text = format_day_summary(day, summary)
        await telegram.send_message(owner_chat_id, text)
    except Exception:
        logger.exception(
            "failed to send the day-close summary to Telegram (business_day_id=%s)", day.id
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
    day = await business_days.close_business_day(
        db,
        business_day_id=business_day_id,
        counted_cash=body.counted_cash,
        now=_now(),
    )
    await notify_day_closed(db, day)
    return day


@router.get("/{business_day_id}/summary", response_model=BusinessDaySummaryResponse)
async def business_day_summary(
    business_day_id: int, db: AsyncSession = Depends(get_session)  # noqa: B008
):
    return await business_days.day_summary(db, business_day_id=business_day_id, now=_now())


@router.get("/{business_day_id}/feed", response_model=list[FeedEventResponse])
async def business_day_feed(
    business_day_id: int,
    limit: int = Query(200, ge=1, le=500),
    db: AsyncSession = Depends(get_session),  # noqa: B008
):
    return await feed_service.day_feed(db, business_day_id=business_day_id, limit=limit)


@router.get("", response_model=list[BusinessDayHistoryItem])
async def list_days(
    limit: int = Query(30, ge=1, le=365), db: AsyncSession = Depends(get_session)  # noqa: B008
):
    days = await business_days.list_business_days(db, limit=limit)
    summaries = await business_days.summaries_for_days(db, days=days, now=_now())
    items = []
    for day in days:
        summary = summaries[day.id]
        items.append(
            BusinessDayHistoryItem(
                **BusinessDayResponse.model_validate(day).model_dump(),
                cash_total=summary.cash_total,
                revenue_total=summary.revenue_total,
                transfer_total=summary.transfer_total,
                sessions_count=summary.sessions_count,
                minutes_total=summary.minutes_total,
                free_minutes_total=summary.free_minutes_total,
                bar_sales_total=summary.bar_sales_total,
            )
        )
    return items
