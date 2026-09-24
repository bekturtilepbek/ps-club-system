import asyncio
import logging

logger = logging.getLogger(__name__)


class HallConnectionManager:
    """Fans a hall snapshot out to every connected browser tab. One instance lives
    for the app's lifetime (see core.api.ws.listener.hall_listener)."""

    def __init__(self) -> None:
        self._connections: set = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket) -> None:
        async with self._lock:
            self._connections.add(websocket)

    async def disconnect(self, websocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)

    async def broadcast(self, message: dict) -> None:
        async with self._lock:
            connections = list(self._connections)
        for connection in connections:
            try:
                await connection.send_json(message)
            except Exception:
                logger.info("dropping a hall websocket connection that failed to send")
                await self.disconnect(connection)


manager = HallConnectionManager()
