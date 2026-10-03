"""The hall's LISTEN connection to Postgres must survive a database restart or network blip."""

import asyncio

import asyncpg
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import core.api.ws.listener as listener_module
from core.api.ws.listener import HallListener, _asyncpg_dsn
from core.db.base import Base
from tests.api.conftest import TEST_DATABASE_URL


class _CountingManager:
    def __init__(self) -> None:
        self.broadcasts = 0

    async def broadcast(self, message: dict) -> None:
        self.broadcasts += 1


async def _until(condition, *, timeout: float, what: str) -> None:
    async def poll() -> None:
        while not condition():
            await asyncio.sleep(0.05)

    try:
        await asyncio.wait_for(poll(), timeout=timeout)
    except TimeoutError:
        pytest.fail(f"timed out waiting for: {what}")


@pytest.mark.asyncio
async def test_listener_reconnects_after_postgres_drops_its_connection(monkeypatch):
    monkeypatch.setattr(listener_module, "RECONNECT_FIRST_DELAY_SECONDS", 0.1)
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    manager = _CountingManager()
    listener = HallListener(manager=manager, session_factory=session_factory)

    async def notify() -> None:
        async with session_factory() as db:
            await db.execute(text("NOTIFY hall_changed"))
            await db.commit()

    await listener.start()
    try:
        await notify()
        await _until(lambda: manager.broadcasts >= 1, timeout=3, what="a push before the drop")

        # What a database restart or a network blip does to the listener's connection.
        admin = await asyncpg.connect(_asyncpg_dsn())
        try:
            await admin.execute(
                f"SELECT pg_terminate_backend({listener._connection.get_server_pid()})"
            )
        finally:
            await admin.close()

        # Reconnected: the listener pushes one fresh snapshot to catch up on what it missed ...
        await _until(
            lambda: manager.broadcasts >= 2, timeout=10, what="a catch-up push after reconnecting"
        )
        # ... and works again for new changes.
        before = manager.broadcasts
        await notify()
        await _until(
            lambda: manager.broadcasts > before, timeout=5, what="a push after the reconnect"
        )
    finally:
        await listener.stop()
        await engine.dispose()


@pytest.mark.asyncio
async def test_listener_reconnects_when_a_silent_connection_fails_its_liveness_check(monkeypatch):
    """A half-open TCP connection never reports that it died; the periodic check catches it."""
    monkeypatch.setattr(listener_module, "LIVENESS_CHECK_SECONDS", 0.1)
    monkeypatch.setattr(listener_module, "RECONNECT_FIRST_DELAY_SECONDS", 0.1)
    checks = {"count": 0}
    really_alive = HallListener._alive

    async def first_check_fails(self) -> bool:
        checks["count"] += 1
        return False if checks["count"] == 1 else await really_alive(self)

    monkeypatch.setattr(HallListener, "_alive", first_check_fails)
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    manager = _CountingManager()
    listener = HallListener(manager=manager, session_factory=session_factory)

    await listener.start()
    try:
        first_connection = listener._connection
        await _until(
            lambda: manager.broadcasts >= 1,
            timeout=5,
            what="a catch-up push after the failed check",
        )
        assert listener._connection is not first_connection
        assert first_connection.is_closed()
    finally:
        await listener.stop()
        await engine.dispose()
