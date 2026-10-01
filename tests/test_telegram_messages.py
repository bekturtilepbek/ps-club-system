from datetime import UTC, datetime, timedelta

from core.db.models import BusinessDay, SegmentKind, SessionKind, SessionSegment, SessionStatus
from core.db.models import Session as SessionModel
from core.services.business_days import DaySummary
from core.services.hall import ConsoleHallView, HallSnapshot, TicketHallView
from core.telegram_messages import (
    format_day_summary,
    format_hall_status,
    format_hours_minutes,
    format_unclosed_day_reminder,
)

T = datetime(2026, 9, 25, 10, 0, tzinfo=UTC)


def test_format_hours_minutes():
    assert format_hours_minutes(90) == "1 ч 30 мин"
    assert format_hours_minutes(0) == "0 ч 0 мин"


def test_format_day_summary_includes_every_breakdown_line():
    day = BusinessDay(
        id=1, opened_at=T, closed_at=T + timedelta(hours=10),
        opening_cash=5000, expected_cash=5300, counted_cash=5300,
    )
    summary = DaySummary(
        opening_cash=5000, cash_total=300, transfer_total=200,
        expected_cash=5300, sessions_count=3, minutes_total=150, free_minutes_total=30,
        bar_sales_total=160, has_active_sessions=False,
    )

    text = format_day_summary(day, summary)

    assert "Выручка за день: 500 сом" in text  # 300 cash + 200 transfer
    assert "300" in text and "200" in text
    assert "5300" in text
    assert "3" in text
    assert "2 ч 30 мин" in text  # 150 minutes total
    assert "0 ч 30 мин" in text  # 30 free minutes
    assert "160" in text


def test_format_unclosed_day_reminder_names_the_open_time_and_planned_close():
    day = BusinessDay(id=1, opened_at=T, opening_cash=5000)

    text = format_unclosed_day_reminder(day, "05:00")

    assert "05:00" in text
    assert "не закрыт" in text


def test_format_day_summary_shows_bishkek_local_time_not_db_utc_tzinfo():
    # Simulates what a real DB round-trip produces: a TIMESTAMP(timezone=True)
    # column always reads back UTC-tagged, even for an instant that was originally
    # written as Bishkek-aware. UTC 04:00 / 14:00 here is Bishkek 10:00 / 20:00.
    day = BusinessDay(
        id=1,
        opened_at=datetime(2026, 9, 25, 4, 0, tzinfo=UTC),
        closed_at=datetime(2026, 9, 25, 14, 0, tzinfo=UTC),
        opening_cash=5000, expected_cash=5300, counted_cash=5300,
    )
    summary = DaySummary(
        opening_cash=5000, cash_total=300, transfer_total=200,
        expected_cash=5300, sessions_count=3, minutes_total=150, free_minutes_total=30,
        bar_sales_total=160, has_active_sessions=False,
    )

    text = format_day_summary(day, summary)

    assert "10:00" in text
    assert "20:00" in text
    assert "04:00" not in text
    assert "14:00" not in text


def test_format_unclosed_day_reminder_shows_bishkek_local_time_not_db_utc_tzinfo():
    day = BusinessDay(id=1, opened_at=datetime(2026, 9, 25, 4, 0, tzinfo=UTC), opening_cash=5000)

    text = format_unclosed_day_reminder(day, "05:00")

    assert "10:00" in text
    assert "04:00" not in text


def test_format_hall_status_lists_busy_and_free_consoles_and_tickets():
    session = SessionModel(
        id=7, console_id=1, business_day_id=1, kind=SessionKind.paid,
        status=SessionStatus.active, started_at=T, grace_until=T,
    )
    session.segments = [
        SessionSegment(
            kind=SegmentKind.package, starts_at=T, ends_at=T + timedelta(minutes=34),
            price_snapshot=150, amount=150,
        )
    ]
    ticket_session = SessionModel(
        id=20, console_id=None, business_day_id=1, kind=SessionKind.paid,
        status=SessionStatus.active, started_at=T, grace_until=T,
    )
    ticket_session.segments = []
    snapshot = HallSnapshot(
        generated_at=T,
        business_day_open=True,
        business_day_id=1,
        consoles=[
            ConsoleHallView(
                id=1, zone_id=1, name="PS5-1", is_active=True,
                session=session, charge_total=150, paid_total=0, balance=150,
            ),
            ConsoleHallView(
                id=2, zone_id=1, name="PS5-2", is_active=True,
                session=None, charge_total=0, paid_total=0, balance=0,
            ),
        ],
        tickets=[
            TicketHallView(session=ticket_session, charge_total=80, paid_total=0, balance=80),
        ],
    )

    text = format_hall_status(snapshot, T)

    assert "занято 1 из 2" in text
    assert "PS5-1" in text and "34 мин" in text and "150" in text
    assert "Чек №20" in text and "80" in text
    assert "PS5-2" in text  # listed as free
