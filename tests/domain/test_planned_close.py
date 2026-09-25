from datetime import datetime
from zoneinfo import ZoneInfo

from core.domain.planned_close import next_planned_close_at

BISHKEK = ZoneInfo("Asia/Bishkek")


def test_returns_the_same_day_when_the_close_time_is_still_ahead():
    anchor = datetime(2026, 9, 25, 10, 0, tzinfo=BISHKEK)
    assert next_planned_close_at(anchor, "22:00") == datetime(2026, 9, 25, 22, 0, tzinfo=BISHKEK)


def test_rolls_over_to_the_next_day_when_the_close_time_already_passed():
    anchor = datetime(2026, 9, 25, 10, 0, tzinfo=BISHKEK)
    assert next_planned_close_at(anchor, "05:00") == datetime(2026, 9, 26, 5, 0, tzinfo=BISHKEK)


def test_treats_the_exact_close_moment_itself_as_already_passed():
    anchor = datetime(2026, 9, 25, 5, 0, tzinfo=BISHKEK)
    assert next_planned_close_at(anchor, "05:00") == datetime(2026, 9, 26, 5, 0, tzinfo=BISHKEK)
