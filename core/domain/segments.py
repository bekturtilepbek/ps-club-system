from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True)
class ActiveSegment:
    kind: str  # "package" | "open"
    starts_at: datetime
    ends_at: datetime | None  # None для ещё идущего открытого отрезка


def grace_until(started_at: datetime, grace_minutes: int) -> datetime:
    """Время на выбор игры (SPEC 3.2): конец пакета сдвигается на эту величину,
    у открытого времени деньги начинают считаться с этого момента, и до него же
    можно бесплатно отменить сессию."""
    return started_at + timedelta(minutes=grace_minutes)


def package_segment_end(start: datetime, duration_min: int) -> datetime:
    return start + timedelta(minutes=duration_min)


def next_segment_start(now: datetime, active: ActiveSegment | None) -> datetime:
    """Где начинается новый отрезок при продлении или переключении на открытое время.

    Пакет, который ещё не закончился, отдаёт своё оставшееся время новому отрезку —
    иначе гость платит дважды за одни и те же минуты (SPEC 3.2, CLAUDE.md rule 3).
    Открытое время закрывается прямо сейчас — оно уже посчитано поминутно до этой секунды.
    """
    if active is None:
        return now
    if active.kind == "package":
        assert active.ends_at is not None
        return max(active.ends_at, now)
    return now


def is_within_grace(now: datetime, grace_until_at: datetime) -> bool:
    return now <= grace_until_at
