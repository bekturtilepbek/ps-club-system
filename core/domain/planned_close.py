from datetime import datetime, timedelta


def next_planned_close_at(anchor: datetime, planned_close: str) -> datetime:
    """The first wall-clock occurrence of `planned_close` ("HH:MM") at or after
    `anchor`, kept in `anchor`'s own timezone.

    Mirrors web/src/features/hall/plannedClose.ts's `nextPlannedCloseMs` — same
    "roll to tomorrow if today's occurrence has already passed" rule — but anchored
    on a business day's `opened_at` (core/services/business_days.py) rather than
    "now", since a day's own planned closing time doesn't move as the clock ticks.
    """
    hours, minutes = (int(part) for part in planned_close.split(":"))
    candidate = anchor.replace(hour=hours, minute=minutes, second=0, microsecond=0)
    if candidate <= anchor:
        candidate += timedelta(days=1)
    return candidate
