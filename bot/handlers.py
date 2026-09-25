from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from core.services.hall import build_hall_snapshot
from core.telegram_messages import format_hall_status


async def build_hall_status_text(db: AsyncSession, now: datetime) -> str:
    snapshot = await build_hall_snapshot(db, now)
    if not snapshot.business_day_open:
        return "День не открыт."
    return format_hall_status(snapshot, now)
