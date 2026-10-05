"""Pure analytics logic: no I/O, no DB. The service layer feeds it plain values."""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo

from core.domain.money import round_som

Group = Literal["day", "week", "month"]

Interval = tuple[datetime, datetime]
Slots = dict[tuple[int, int], int]  # (weekday 0=Mon, hour) -> busy seconds


def effective_intervals(
    segments: Iterable[tuple[datetime, datetime | None]],
    *,
    ended_at: datetime | None,
    now: datetime,
) -> list[Interval]:
    """The time a session really occupied the hall, segment by segment.

    A package stopped early stays fully priced, but the console was in use only until the guests
    left. An open segment runs until now. One queued behind a running package starts in the
    future and has run for no time yet, so it is dropped rather than counted as negative."""
    result: list[Interval] = []
    for starts_at, ends_at in segments:
        end = ends_at or now
        if ended_at is not None:
            end = min(end, ended_at)
        if end > starts_at:
            result.append((starts_at, end))
    return result


def interval_minutes(intervals: Iterable[Interval]) -> int:
    return sum(int((end - start).total_seconds() // 60) for start, end in intervals)


def add_to_slots(slots: Slots, start: datetime, end: datetime, tz: ZoneInfo) -> None:
    """Spread [start, end) over the club's clock hours. Asia/Bishkek has no DST, so adding a
    timedelta to a local datetime is wall-clock arithmetic and hours are always 3600 s."""
    cursor = start.astimezone(tz)
    stop = end.astimezone(tz)
    while cursor < stop:
        boundary = cursor.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        piece_end = min(stop, boundary)
        key = (cursor.weekday(), cursor.hour)
        slots[key] = slots.get(key, 0) + int((piece_end - cursor).total_seconds())
        cursor = piece_end


def weekday_occurrences(date_from: date, date_to: date) -> list[int]:
    """How many Mondays, Tuesdays, ... the calendar range contains (index 0 = Monday)."""
    counts = [0] * 7
    day = date_from
    while day <= date_to:
        counts[day.weekday()] += 1
        day += timedelta(days=1)
    return counts


@dataclass(frozen=True)
class LoadCell:
    weekday: int
    hour: int
    busy_minutes: int
    load_percent: float


def _percent(busy_seconds: int, capacity_seconds: int) -> float:
    if capacity_seconds <= 0:
        return 0.0
    return min(100.0, round(busy_seconds / capacity_seconds * 100, 1))


def build_load_cells(slots: Slots, occurrences: list[int], consoles_count: int) -> list[LoadCell]:
    """168 cells. Capacity of a cell = how many such weekday-hours the range holds x consoles."""
    cells: list[LoadCell] = []
    for weekday in range(7):
        for hour in range(24):
            busy = slots.get((weekday, hour), 0)
            capacity = occurrences[weekday] * consoles_count * 3600
            cells.append(
                LoadCell(
                    weekday=weekday,
                    hour=hour,
                    busy_minutes=round(busy / 60),
                    load_percent=_percent(busy, capacity),
                )
            )
    return cells


def hourly_load(
    slots: Slots, occurrences: list[int], consoles_count: int
) -> list[tuple[int, float]]:
    """Average load of each clock hour over all weekdays of the range."""
    result: list[tuple[int, float]] = []
    for hour in range(24):
        busy = sum(slots.get((weekday, hour), 0) for weekday in range(7))
        capacity = sum(occurrences) * consoles_count * 3600
        result.append((hour, _percent(busy, capacity)))
    return result


def quietest_and_busiest(cells: list[LoadCell]) -> tuple[LoadCell | None, LoadCell | None]:
    """Only hours in which the club had any activity are candidates: 04:00 is not "the quietest
    time", it is closed. Ties go to the earliest weekday, then the earliest hour."""
    active_hours = {cell.hour for cell in cells if cell.busy_minutes > 0}
    candidates = [cell for cell in cells if cell.hour in active_hours]
    if not candidates:
        return None, None
    quietest = min(candidates, key=lambda c: (c.load_percent, c.weekday, c.hour))
    busiest = min(candidates, key=lambda c: (-c.load_percent, c.weekday, c.hour))
    return quietest, busiest


def previous_period(date_from: date, date_to: date) -> tuple[date, date]:
    length = (date_to - date_from).days + 1
    prev_to = date_from - timedelta(days=1)
    return prev_to - timedelta(days=length - 1), prev_to


def change_percent(current: int | None, previous: int | None) -> float | None:
    if current is None or previous is None or previous == 0:
        return None
    return round((current - previous) / previous * 100, 1)


def bucket_start(day: date, group: Group) -> date:
    if group == "week":
        return day - timedelta(days=day.weekday())
    if group == "month":
        return day.replace(day=1)
    return day


def _next_bucket(start: date, group: Group) -> date:
    if group == "day":
        return start + timedelta(days=1)
    if group == "week":
        return start + timedelta(days=7)
    return (start.replace(day=28) + timedelta(days=4)).replace(day=1)


def bucket_starts(date_from: date, date_to: date, group: Group) -> list[date]:
    starts: list[date] = []
    cursor = bucket_start(date_from, group)
    while cursor <= date_to:
        starts.append(cursor)
        cursor = _next_bucket(cursor, group)
    return starts


def average(total: int, count: int) -> int | None:
    if count == 0:
        return None
    return round_som(Decimal(total) / Decimal(count))
