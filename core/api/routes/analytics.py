from dataclasses import asdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.clock import now as _now
from core.api.deps import require_auth
from core.api.schemas.analytics import (
    AnalyticsBarResponse,
    AnalyticsGamesResponse,
    AnalyticsLoadResponse,
    AnalyticsRevenueResponse,
    AnalyticsSummaryResponse,
)
from core.db.session import get_session
from core.domain.analytics import Group
from core.services import analytics

router = APIRouter(prefix="/analytics", tags=["analytics"], dependencies=[Depends(require_auth)])


def period(
    date_from: date = Query(alias="from"),  # noqa: B008
    date_to: date = Query(alias="to"),  # noqa: B008
) -> tuple[date, date]:
    if date_to < date_from:
        raise HTTPException(status_code=422, detail="'to' must not be before 'from'")
    if (date_to - date_from).days > analytics.MAX_RANGE_DAYS:
        raise HTTPException(status_code=422, detail="the range is too long")
    return date_from, date_to


@router.get("/summary", response_model=AnalyticsSummaryResponse)
async def get_summary(
    span: tuple[date, date] = Depends(period),  # noqa: B008
    db: AsyncSession = Depends(get_session),  # noqa: B008
):
    now = _now()
    result = await analytics.summary(
        db, date_from=span[0], date_to=span[1], today=now.date(), now=now
    )
    return {
        "date_from": result.date_from,
        "date_to": result.date_to,
        "includes_open_day": result.includes_open_day,
        "current": {**asdict(result.current), "revenue_total": result.current.revenue_total},
        "previous": {**asdict(result.previous), "revenue_total": result.previous.revenue_total},
        "changes": result.changes,
    }


@router.get("/revenue", response_model=AnalyticsRevenueResponse)
async def get_revenue(
    group: Group = "day",
    span: tuple[date, date] = Depends(period),  # noqa: B008
    db: AsyncSession = Depends(get_session),  # noqa: B008
):
    date_from, date_to, points = await analytics.revenue_series(
        db, date_from=span[0], date_to=span[1], group=group, today=_now().date()
    )
    return {"date_from": date_from, "date_to": date_to, "points": [asdict(p) for p in points]}


@router.get("/load", response_model=AnalyticsLoadResponse)
async def get_load(
    span: tuple[date, date] = Depends(period),  # noqa: B008
    db: AsyncSession = Depends(get_session),  # noqa: B008
):
    now = _now()
    result = await analytics.load(db, date_from=span[0], date_to=span[1], today=now.date(), now=now)
    return {
        "date_from": result.date_from,
        "date_to": result.date_to,
        "consoles_count": result.consoles_count,
        "cells": [asdict(cell) for cell in result.cells],
        "hourly": [{"hour": h, "load_percent": p} for h, p in result.hourly],
        "quietest": asdict(result.quietest) if result.quietest else None,
        "busiest": asdict(result.busiest) if result.busiest else None,
    }


@router.get("/bar", response_model=AnalyticsBarResponse)
async def get_bar(
    span: tuple[date, date] = Depends(period),  # noqa: B008
    db: AsyncSession = Depends(get_session),  # noqa: B008
):
    date_from, date_to, rows = await analytics.bar_sales(
        db, date_from=span[0], date_to=span[1], today=_now().date()
    )
    return {"date_from": date_from, "date_to": date_to, "rows": [asdict(r) for r in rows]}


@router.get("/games", response_model=AnalyticsGamesResponse)
async def get_games(
    span: tuple[date, date] = Depends(period),  # noqa: B008
    db: AsyncSession = Depends(get_session),  # noqa: B008
):
    date_from, date_to, rows = await analytics.games_ranking(
        db, date_from=span[0], date_to=span[1], today=_now().date()
    )
    return {"date_from": date_from, "date_to": date_to, "rows": [asdict(r) for r in rows]}
