from datetime import UTC, datetime, timedelta

from core.domain.segments import (
    ActiveSegment,
    grace_until,
    is_within_grace,
    next_segment_start,
    package_segment_end,
)

T = datetime(2026, 9, 23, 12, 0, 0, tzinfo=UTC)


def test_grace_until_shifts_by_grace_minutes():
    assert grace_until(T, grace_minutes=3) == T + timedelta(minutes=3)


def test_package_segment_end_adds_duration():
    assert package_segment_end(T, duration_min=180) == T + timedelta(hours=3)


def test_is_within_grace():
    deadline = T + timedelta(minutes=3)
    assert is_within_grace(deadline - timedelta(seconds=1), deadline) is True
    assert is_within_grace(deadline, deadline) is True
    assert is_within_grace(deadline + timedelta(seconds=1), deadline) is False


def test_next_segment_start_with_no_active_segment_is_now():
    assert next_segment_start(T, active=None) == T


def test_next_segment_start_chains_at_package_end_while_still_running():
    # A package runs from T to T+60min; extending at T+10min -> the new segment
    # starts at T+60min, otherwise the guest pays twice for the same minutes (SPEC 3.2).
    active = ActiveSegment(kind="package", starts_at=T, ends_at=T + timedelta(minutes=60))
    assert next_segment_start(T + timedelta(minutes=10), active) == T + timedelta(minutes=60)


def test_next_segment_start_uses_now_once_package_already_ended():
    active = ActiveSegment(kind="package", starts_at=T, ends_at=T + timedelta(minutes=60))
    now = T + timedelta(minutes=70)
    assert next_segment_start(now, active) == now


def test_next_segment_start_closes_open_segment_at_now():
    active = ActiveSegment(kind="open", starts_at=T, ends_at=None)
    now = T + timedelta(minutes=15)
    assert next_segment_start(now, active) == now
