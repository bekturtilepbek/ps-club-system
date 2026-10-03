import asyncio
import contextlib
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

# How long the supervisor trusts a silent connection before checking it is really alive (a
# half-open TCP connection never reports that it died), and how it backs off between attempts
# while the database is unreachable.
LIVENESS_CHECK_SECONDS = 30
LIVENESS_CHECK_TIMEOUT_SECONDS = 10
RECONNECT_FIRST_DELAY_SECONDS = 1.0
RECONNECT_MAX_DELAY_SECONDS = 30.0


def _asyncpg_dsn() -> str:
    return settings.database_url.replace("postgresql+asyncpg://", "postgresql://", 1)


class HallListener:
    """Owns one dedicated asyncpg connection LISTENing on `hall_changed`, and
    re-broadcasts the current hall snapshot to every connected browser whenever a
    session/payment/business-day mutation NOTIFYs it. `session_factory` and
    `manager` are overridable so tests can broadcast without a real LISTEN
    round-trip and without touching the production database.

    A LISTEN connection that Postgres drops (a database restart, a network blip) stays dead
    on its own: pushes would silently stop until the API restarted and other tills would lag
    by up to the 60 s safety poll. A supervisor task notices the loss, reconnects with backoff
    and pushes one fresh snapshot to cover the changes missed in the meantime."""

    def __init__(
        self,
        *,
        manager: HallConnectionManager = default_manager,
        session_factory=async_session_factory,
    ) -> None:
        self._manager = manager
        self._session_factory = session_factory
        self._connection: asyncpg.Connection | None = None
        self._lost = asyncio.Event()
        self._stopping = False
        self._supervisor: asyncio.Task | None = None

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

    async def _connect(self) -> None:
        connection = await asyncpg.connect(_asyncpg_dsn())
        try:
            await connection.add_listener(CHANNEL, self._on_notify)
            connection.add_termination_listener(lambda _connection: self._lost.set())
        except BaseException:
            await connection.close()
            raise
        self._connection = connection

    async def _alive(self) -> bool:
        connection = self._connection
        if connection is None or connection.is_closed():
            return False
        try:
            await asyncio.wait_for(connection.fetchval("SELECT 1"), LIVENESS_CHECK_TIMEOUT_SECONDS)
        except Exception:
            return False
        return True

    async def _reconnect(self) -> None:
        old, self._connection = self._connection, None
        if old is not None:
            with contextlib.suppress(Exception):
                old.terminate()
        delay = RECONNECT_FIRST_DELAY_SECONDS
        while not self._stopping:
            try:
                await self._connect()
            except Exception as error:
                logger.warning(
                    "hall listener cannot reconnect (%s), retrying in %.0f s", error, delay
                )
                await asyncio.sleep(delay)
                delay = min(delay * 2, RECONNECT_MAX_DELAY_SECONDS)
                continue
            logger.info("hall listener reconnected, LISTEN %s", CHANNEL)
            try:
                await self.broadcast_current_snapshot()
            except Exception:
                logger.exception("failed to push the catch-up hall snapshot after reconnecting")
            return

    async def _supervise(self) -> None:
        while not self._stopping:
            try:
                await asyncio.wait_for(self._lost.wait(), LIVENESS_CHECK_SECONDS)
            except TimeoutError:
                if await self._alive():
                    continue
                logger.warning("hall listener connection stopped answering")
            if self._stopping:
                return
            self._lost.clear()
            logger.warning("hall listener lost its connection to Postgres")
            await self._reconnect()

    async def start(self) -> None:
        await self._connect()
        logger.info("hall listener connected, LISTEN %s", CHANNEL)
        self._supervisor = asyncio.create_task(self._supervise())

    async def stop(self) -> None:
        self._stopping = True
        self._lost.set()
        if self._supervisor is not None:
            self._supervisor.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._supervisor
            self._supervisor = None
        if self._connection is not None:
            with contextlib.suppress(Exception):
                await self._connection.remove_listener(CHANNEL, self._on_notify)
                await self._connection.close()
            self._connection = None


hall_listener = HallListener()
