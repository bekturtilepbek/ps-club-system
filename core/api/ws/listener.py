import logging

import asyncpg

from core.api.clock import now as _now
from core.api.schemas.hall import hall_snapshot_to_response
from core.api.ws.manager import HallConnectionManager
from core.api.ws.manager import manager as default_manager
from core.config import settings
from core.db.session import async_session_factory
from core.services import hall as hall_service

logger = logging.getLogger(__name__)

CHANNEL = "hall_changed"


def _asyncpg_dsn() -> str:
    return settings.database_url.replace("postgresql+asyncpg://", "postgresql://", 1)


class HallListener:
    """Owns one dedicated asyncpg connection LISTENing on `hall_changed`, and
    re-broadcasts the current hall snapshot to every connected browser whenever a
    session/payment/business-day mutation NOTIFYs it. `session_factory` and
    `manager` are overridable so tests can broadcast without a real LISTEN
    round-trip and without touching the production database."""

    def __init__(
        self,
        *,
        manager: HallConnectionManager = default_manager,
        session_factory=async_session_factory,
    ) -> None:
        self._manager = manager
        self._session_factory = session_factory
        self._connection: asyncpg.Connection | None = None

    async def broadcast_current_snapshot(self) -> None:
        async with self._session_factory() as db:
            snapshot = await hall_service.build_hall_snapshot(db, _now())
        await self._manager.broadcast(hall_snapshot_to_response(snapshot).model_dump(mode="json"))

    async def _on_notify(self, connection, pid, channel, payload) -> None:
        # asyncpg runs this as a fire-and-forget task; log failures here, otherwise
        # they only surface as "Task exception was never retrieved" at GC time.
        try:
            await self.broadcast_current_snapshot()
        except Exception:
            logger.exception("failed to broadcast the hall snapshot after %s", channel)

    async def start(self) -> None:
        self._connection = await asyncpg.connect(_asyncpg_dsn())
        await self._connection.add_listener(CHANNEL, self._on_notify)
        logger.info("hall listener connected, LISTEN %s", CHANNEL)

    async def stop(self) -> None:
        if self._connection is not None:
            await self._connection.remove_listener(CHANNEL, self._on_notify)
            await self._connection.close()
            self._connection = None


hall_listener = HallListener()
