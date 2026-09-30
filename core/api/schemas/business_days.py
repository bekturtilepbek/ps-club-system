from datetime import datetime

from pydantic import BaseModel, ConfigDict


class BusinessDayOpenRequest(BaseModel):
    opening_cash: int


class BusinessDayCloseRequest(BaseModel):
    counted_cash: int


class BusinessDayResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    opened_at: datetime
    closed_at: datetime | None
    opening_cash: int
    expected_cash: int | None
    counted_cash: int | None


class BusinessDaySummaryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    opening_cash: int
    cash_total: int
    qr_total: int
    transfer_total: int
    expected_cash: int
    sessions_count: int
    minutes_total: int
    free_minutes_total: int
    bar_sales_total: int
    has_active_sessions: bool


class BusinessDayHistoryItem(BusinessDayResponse):
    """A day in the history list, with its totals. Cash and non-cash stay apart
    (CLAUDE.md rule 10)."""

    cash_total: int
    qr_total: int
    transfer_total: int
    sessions_count: int
    minutes_total: int
    free_minutes_total: int
    bar_sales_total: int
