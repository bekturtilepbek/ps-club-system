from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True)
class ActiveSegment:
    kind: str  # "package" | "open"
    starts_at: datetime
    ends_at: datetime | None  # None for an open segment still running


def grace_until(started_at: datetime, grace_minutes: int) -> datetime:
    """Time to choose a game (SPEC 3.2): a package's end is shifted by this amount,
    an open segment's billing starts from this moment, and cancelling for free is
    possible up to this same deadline."""
    return started_at + timedelta(minutes=grace_minutes)


def package_segment_end(start: datetime, duration_min: int) -> datetime:
    return start + timedelta(minutes=duration_min)


def next_segment_start(now: datetime, active: ActiveSegment | None) -> datetime:
    """Where a new segment starts on extension or switching to open time.

    A package that hasn't ended yet hands its remaining time to the new segment —
    otherwise the guest pays twice for the same minutes (SPEC 3.2, CLAUDE.md rule 3).
    Open time closes right now — it's already billed per minute up to this second.
    """
    if active is None:
        return now
    if active.kind == "package":
        assert active.ends_at is not None
        return max(active.ends_at, now)
    return now


def is_within_grace(now: datetime, grace_until_at: datetime) -> bool:
    return now <= grace_until_at
