from datetime import date

from pydantic import BaseModel


class PeriodTotalsResponse(BaseModel):
    cash_total: int
    transfer_total: int
    revenue_total: int
    paid_sessions_count: int
    avg_check: int | None
    bar_per_session: int | None
    free_minutes: int
    service_minutes: int
    bar_sales_total: int


class AnalyticsSummaryResponse(BaseModel):
    date_from: date
    date_to: date
    # True while a business day inside the range is still open: today's numbers are provisional.
    includes_open_day: bool
    current: PeriodTotalsResponse
    previous: PeriodTotalsResponse
    # Percent change current vs previous; null when there is nothing to compare with.
    changes: dict[str, float | None]


class RevenuePointResponse(BaseModel):
    period_start: date
    cash_total: int
    transfer_total: int


class AnalyticsRevenueResponse(BaseModel):
    date_from: date
    date_to: date
    points: list[RevenuePointResponse]


class LoadCellResponse(BaseModel):
    weekday: int  # 0 = Monday
    hour: int
    busy_minutes: int
    load_percent: float


class HourLoadResponse(BaseModel):
    hour: int
    load_percent: float


class AnalyticsLoadResponse(BaseModel):
    date_from: date
    date_to: date
    consoles_count: int
    cells: list[LoadCellResponse]
    hourly: list[HourLoadResponse]
    quietest: LoadCellResponse | None
    busiest: LoadCellResponse | None


class BarRowResponse(BaseModel):
    name: str
    qty: int
    revenue: int


class AnalyticsBarResponse(BaseModel):
    date_from: date
    date_to: date
    rows: list[BarRowResponse]


class GameRowResponse(BaseModel):
    name: str | None  # null = no game was chosen
    sessions: int
    revenue: int


class AnalyticsGamesResponse(BaseModel):
    date_from: date
    date_to: date
    rows: list[GameRowResponse]
