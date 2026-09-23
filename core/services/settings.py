import logging

from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import Setting

logger = logging.getLogger(__name__)

DEFAULT_GRACE_MINUTES = 3
DEFAULT_WARN_MINUTES = 5


async def get_setting(db: AsyncSession, key: str) -> str | None:
    row = await db.get(Setting, key)
    return row.value if row else None


def _parse_int_setting(key: str, value: str | None, default: int) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        logger.warning("setting %r has a non-numeric value %r, using default %d", key, value, default)
        return default


async def get_grace_minutes(db: AsyncSession) -> int:
    value = await get_setting(db, "grace_minutes")
    return _parse_int_setting("grace_minutes", value, DEFAULT_GRACE_MINUTES)


async def get_warn_minutes(db: AsyncSession) -> int:
    value = await get_setting(db, "warn_minutes")
    return _parse_int_setting("warn_minutes", value, DEFAULT_WARN_MINUTES)
