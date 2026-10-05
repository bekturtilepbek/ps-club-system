from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from core.domain.analytics import (
    LoadCell,
    add_to_slots,
    average,
    bucket_start,
    bucket_starts,
    build_load_cells,
    change_percent,
    effective_intervals,
    hourly_load,
    interval_minutes,
    previous_period,
    quietest_and_busiest,
    weekday_occurrences,
)

TZ = ZoneInfo("Asia/Bishkek")


def at(day: int, hour: int, minute: int = 0) -> datetime:
    """2026-09-<day> in Bishkek. 2026-09-14 is a Monday."""
    return datetime(2026, 9, day, hour, minute, tzinfo=TZ)


def test_effective_intervals_clips_to_the_early_stop():
    segments = [(at(14, 10), at(14, 12))]
    assert effective_intervals(segments, ended_at=at(14, 11), now=at(14, 20)) == [
        (at(14, 10), at(14, 11))
    ]


def test_effective_intervals_runs_an_open_segment_until_now():
    assert effective_intervals([(at(14, 10), None)], ended_at=None, now=at(14, 10, 30)) == [
        (at(14, 10), at(14, 10, 30))
    ]


def test_effective_intervals_drops_a_segment_that_starts_in_the_future():
    # An open segment queued behind a running package has not started yet.
    assert effective_intervals([(at(14, 12), None)], ended_at=None, now=at(14, 11)) == []


def test_interval_minutes_floors_each_interval():
    intervals = [(at(14, 10), at(14, 10, 1)), (at(14, 11), at(14, 11, 0) + timedelta(seconds=90))]
    assert interval_minutes(intervals) == 1 + 1


def test_add_to_slots_splits_at_the_hour_boundary():
    slots: dict[tuple[int, int], int] = defaultdict(int)
    add_to_slots(slots, at(14, 10, 30), at(14, 11, 15), TZ)
    assert slots == {(0, 10): 30 * 60, (0, 11): 15 * 60}


def test_add_to_slots_crosses_midnight_into_the_next_weekday():
    slots: dict[tuple[int, int], int] = defaultdict(int)
    add_to_slots(slots, at(14, 23, 30), at(15, 0, 30), TZ)  # Monday 23:30 -> Tuesday 00:30
    assert slots == {(0, 23): 30 * 60, (1, 0): 30 * 60}


def test_add_to_slots_reads_the_club_clock_not_utc():
    slots: dict[tuple[int, int], int] = defaultdict(int)
    # 18:00 UTC is 00:00 Tuesday in Bishkek.
    add_to_slots(
        slots,
        datetime(2026, 9, 14, 18, 0, tzinfo=UTC),
        datetime(2026, 9, 14, 18, 30, tzinfo=UTC),
        TZ,
    )
    assert slots == {(1, 0): 30 * 60}


def test_weekday_occurrences_counts_each_weekday_in_the_range():
    # Mon 14 .. Sun 20 is exactly one of each; adding Mon 21 makes two Mondays.
    assert weekday_occurrences(date(2026, 9, 14), date(2026, 9, 20)) == [1] * 7
    assert weekday_occurrences(date(2026, 9, 14), date(2026, 9, 21)) == [2, 1, 1, 1, 1, 1, 1]


def test_build_load_cells_percent_is_busy_over_capacity():
    slots = {(0, 10): 3600}  # one console busy a full Monday 10:00 hour
    cells = build_load_cells(slots, [1] * 7, consoles_count=4)
    assert len(cells) == 168
    cell = next(c for c in cells if c.weekday == 0 and c.hour == 10)
    assert cell.busy_minutes == 60
    assert cell.load_percent == 25.0  # 60 of 4 consoles * 60 minutes
    assert next(c for c in cells if c.weekday == 3 and c.hour == 3).load_percent == 0.0


def test_build_load_cells_caps_at_100_and_survives_zero_capacity():
    assert build_load_cells({(0, 10): 99999}, [1] * 7, 1)[10].load_percent == 100.0
    assert all(c.load_percent == 0.0 for c in build_load_cells({(0, 10): 60}, [1] * 7, 0))


def test_hourly_load_averages_all_weekdays():
    slots = {(0, 10): 3600, (1, 10): 3600}  # 2 of the 7 Monday..Sunday 10:00 hours, 1 console
    hourly = dict(hourly_load(slots, [1] * 7, consoles_count=1))
    assert len(hourly) == 24
    assert hourly[10] == round(2 / 7 * 100, 1)
    assert hourly[3] == 0.0


def test_quietest_and_busiest_ignore_hours_the_club_was_never_open():
    cells = build_load_cells({(0, 10): 3600, (0, 11): 1800}, [1] * 7, consoles_count=1)
    quietest, busiest = quietest_and_busiest(cells)
    assert busiest == LoadCell(weekday=0, hour=10, busy_minutes=60, load_percent=100.0)
    # Hour 03:00 has no activity anywhere, so it must not be reported as "the quietest time".
    assert quietest == LoadCell(weekday=1, hour=10, busy_minutes=0, load_percent=0.0)


def test_quietest_and_busiest_are_none_without_any_activity():
    assert quietest_and_busiest(build_load_cells({}, [1] * 7, 3)) == (None, None)


def test_previous_period_is_the_same_length_right_before():
    assert previous_period(date(2026, 9, 8), date(2026, 9, 14)) == (
        date(2026, 9, 1),
        date(2026, 9, 7),
    )
    assert previous_period(date(2026, 9, 14), date(2026, 9, 14)) == (
        date(2026, 9, 13),
        date(2026, 9, 13),
    )


def test_change_percent():
    assert change_percent(112, 100) == 12.0
    assert change_percent(95, 100) == -5.0
    assert change_percent(10, 0) is None  # nothing to compare with
    assert change_percent(None, 100) is None
    assert change_percent(100, None) is None


def test_bucket_start():
    wed = date(2026, 9, 16)
    assert bucket_start(wed, "day") == wed
    assert bucket_start(wed, "week") == date(2026, 9, 14)  # the Monday
    assert bucket_start(wed, "month") == date(2026, 9, 1)


def test_bucket_starts_fills_every_bucket_in_the_range():
    assert bucket_starts(date(2026, 9, 15), date(2026, 9, 17), "day") == [
        date(2026, 9, 15),
        date(2026, 9, 16),
        date(2026, 9, 17),
    ]
    assert bucket_starts(date(2026, 9, 16), date(2026, 9, 29), "week") == [
        date(2026, 9, 14),
        date(2026, 9, 21),
        date(2026, 9, 28),
    ]
    assert bucket_starts(date(2026, 8, 20), date(2026, 10, 2), "month") == [
        date(2026, 8, 1),
        date(2026, 9, 1),
        date(2026, 10, 1),
    ]
    assert bucket_starts(date(2026, 12, 5), date(2027, 1, 5), "month") == [
        date(2026, 12, 1),
        date(2027, 1, 1),
    ]


def test_average_rounds_to_whole_som_and_handles_zero():
    assert average(1000, 3) == 333
    assert average(1001, 2) == 501  # half rounds up, like every other som total
    assert average(0, 0) is None


def test_effective_intervals_clips_a_running_package_to_now():
    segments = [(at(14, 10), at(14, 12))]
    assert effective_intervals(segments, ended_at=None, now=at(14, 10, 30)) == [
        (at(14, 10), at(14, 10, 30))
    ]


def test_effective_intervals_drops_a_queued_package_that_has_not_started():
    segments = [(at(14, 12), at(14, 13))]
    assert effective_intervals(segments, ended_at=None, now=at(14, 11)) == []


def test_effective_intervals_keeps_a_finished_segment_whole():
    segments = [(at(14, 10), at(14, 11))]
    assert effective_intervals(segments, ended_at=None, now=at(14, 20)) == [
        (at(14, 10), at(14, 11))
    ]
