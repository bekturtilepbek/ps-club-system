from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import Setting

DEFAULT_GRACE_MINUTES = 3
DEFAULT_WARN_MINUTES = 5


async def get_setting(db: AsyncSession, key: str) -> str | None:
    row = await db.get(Setting, key)
    return row.value if row else None


async def get_grace_minutes(db: AsyncSession) -> int:
    value = await get_setting(db, "grace_minutes")
    return int(value) if value is not None else DEFAULT_GRACE_MINUTES


async def get_warn_minutes(db: AsyncSession) -> int:
    value = await get_setting(db, "warn_minutes")
    return int(value) if value is not None else DEFAULT_WARN_MINUTES
