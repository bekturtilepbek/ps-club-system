from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import Game


async def list_active_games(db: AsyncSession) -> list[Game]:
    """The games offered at session start: the owner's list minus hidden entries, by name so
    the order never jumps around between shifts."""
    result = await db.execute(select(Game).where(Game.is_active.is_(True)).order_by(Game.name))
    return list(result.scalars().all())
