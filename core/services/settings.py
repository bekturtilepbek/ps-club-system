import logging

from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import Setting

logger = logging.getLogger(__name__)

DEFAULT_GRACE_MINUTES = 3
DEFAULT_WARN_MINUTES = 5
DEFAULT_PLANNED_OPEN = "10:00"
DEFAULT_PLANNED_CLOSE = "05:00"
DEFAULT_DAY_REMINDER_THRESHOLD_MINUTES = 60
DEFAULT_DAY_REMINDER_INTERVAL_MINUTES = 60


async def get_setting(db: AsyncSession, key: str) -> str | None:
    row = await db.get(Setting, key)
    return row.value if row else None


def _parse_int_setting(key: str, value: str | None, default: int) -> int:
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        logger.warning(
            "setting %r has a non-numeric value %r, using default %d",
            key,
            value,
            default,
        )
        return default
    if parsed < 0:
        logger.warning(
            "setting %r has a negative value %r, using default %d",
            key,
            value,
            default,
        )
        return default
    return parsed


async def get_grace_minutes(db: AsyncSession) -> int:
    value = await get_setting(db, "grace_minutes")
    return _parse_int_setting("grace_minutes", value, DEFAULT_GRACE_MINUTES)


async def get_warn_minutes(db: AsyncSession) -> int:
    value = await get_setting(db, "warn_minutes")
    return _parse_int_setting("warn_minutes", value, DEFAULT_WARN_MINUTES)


def _parse_time_setting(key: str, value: str | None, default: str) -> str:
    candidate = value if value is not None else default
    try:
        hours_str, minutes_str = candidate.split(":")
        hours, minutes = int(hours_str), int(minutes_str)
        if not (0 <= hours <= 23 and 0 <= minutes <= 59):
            raise ValueError
    except (ValueError, AttributeError):
        logger.warning(
            "setting %r has an invalid time value %r, using default %r", key, candidate, default
        )
        return default
    return f"{hours:02d}:{minutes:02d}"


async def get_planned_open(db: AsyncSession) -> str:
    value = await get_setting(db, "planned_open")
    return _parse_time_setting("planned_open", value, DEFAULT_PLANNED_OPEN)


async def get_planned_close(db: AsyncSession) -> str:
    value = await get_setting(db, "planned_close")
    return _parse_time_setting("planned_close", value, DEFAULT_PLANNED_CLOSE)


async def get_owner_chat_id(db: AsyncSession) -> int | None:
    value = await get_setting(db, "owner_chat_id")
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        logger.warning("setting 'owner_chat_id' has a non-numeric value %r, ignoring", value)
        return None


async def get_day_reminder_threshold_minutes(db: AsyncSession) -> int:
    value = await get_setting(db, "day_reminder_threshold_minutes")
    return _parse_int_setting(
        "day_reminder_threshold_minutes", value, DEFAULT_DAY_REMINDER_THRESHOLD_MINUTES
    )


async def get_day_reminder_interval_minutes(db: AsyncSession) -> int:
    value = await get_setting(db, "day_reminder_interval_minutes")
    return _parse_int_setting(
        "day_reminder_interval_minutes", value, DEFAULT_DAY_REMINDER_INTERVAL_MINUTES
    )
