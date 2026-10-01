from datetime import datetime
from zoneinfo import ZoneInfo

from core.config import settings
from core.db.models import BusinessDay, SegmentKind
from core.services.business_days import DaySummary
from core.services.hall import HallSnapshot


def format_hours_minutes(total_minutes: int) -> str:
    hours, minutes = divmod(total_minutes, 60)
    return f"{hours} ч {minutes} мин"


def format_day_summary(day: BusinessDay, summary: DaySummary) -> str:
    # day.opened_at/closed_at, loaded from TIMESTAMP(timezone=True) columns, come
    # back UTC-tagged even when written as Bishkek-aware (same instant, different
    # tzinfo) — convert before formatting so the owner sees local wall-clock time.
    opened_at = day.opened_at.astimezone(ZoneInfo(settings.timezone))
    closed_at = day.closed_at.astimezone(ZoneInfo(settings.timezone)) if day.closed_at else None
    lines = [
        f"Итоги дня — {opened_at:%d.%m %H:%M} — {closed_at:%d.%m %H:%M}"
        if closed_at is not None
        else f"Итоги дня — {opened_at:%d.%m %H:%M}",
        f"Наличные: {summary.cash_total} сом (ожидалось {summary.expected_cash}, "
        f"посчитано {day.counted_cash})",
        f"Перевод: {summary.transfer_total} сом",
        f"Сессий: {summary.sessions_count}, часов: {format_hours_minutes(summary.minutes_total)}",
        f"Бесплатно: {format_hours_minutes(summary.free_minutes_total)}",
        f"Продажи бара: {summary.bar_sales_total} сом",
    ]
    return "\n".join(lines)


def format_unclosed_day_reminder(day: BusinessDay, planned_close: str) -> str:
    opened_at = day.opened_at.astimezone(ZoneInfo(settings.timezone))
    return (
        f"День открыт с {opened_at:%d.%m %H:%M} и всё ещё не закрыт "
        f"(плановое закрытие — {planned_close}). Закройте день в приложении, когда "
        f"будете готовы — автоматически он не закроется."
    )


def format_hall_status(snapshot: HallSnapshot, now: datetime) -> str:
    busy = [c for c in snapshot.consoles if c.session is not None]
    free = [c for c in snapshot.consoles if c.session is None]

    lines = [f"Зал: занято {len(busy)} из {len(snapshot.consoles)}"]

    for console in busy:
        session = console.session
        assert session is not None
        segment = session.segments[-1] if session.segments else None
        if (
            segment is not None
            and segment.kind == SegmentKind.package
            and segment.ends_at is not None
        ):
            remaining_minutes = max(0, int((segment.ends_at - now).total_seconds() // 60))
            status = f"пакет, осталось {remaining_minutes} мин"
        else:
            status = "открытое время"
        lines.append(f"{console.name}: {status}, к оплате {console.balance} сом")

    for ticket in snapshot.tickets:
        lines.append(f"Чек №{ticket.session.id}: к оплате {ticket.balance} сом")

    if free:
        lines.append("Свободно: " + ", ".join(c.name for c in free))

    return "\n".join(lines)
