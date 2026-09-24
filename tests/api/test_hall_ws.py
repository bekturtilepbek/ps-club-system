import pytest

from core.api.ws.listener import HallListener
from core.api.ws.manager import HallConnectionManager


class _FakeWebSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)


@pytest.mark.asyncio
async def test_manager_broadcasts_to_every_connection():
    manager = HallConnectionManager()
    ws_a, ws_b = _FakeWebSocket(), _FakeWebSocket()
    await manager.connect(ws_a)
    await manager.connect(ws_b)

    await manager.broadcast({"hello": "world"})

    assert ws_a.sent == [{"hello": "world"}]
    assert ws_b.sent == [{"hello": "world"}]


@pytest.mark.asyncio
async def test_manager_drops_a_connection_that_fails_to_send():
    manager = HallConnectionManager()

    class _BrokenWebSocket(_FakeWebSocket):
        async def send_json(self, message: dict) -> None:
            raise RuntimeError("connection gone")

    broken = _BrokenWebSocket()
    await manager.connect(broken)
    await manager.broadcast({"x": 1})  # must not raise

    good = _FakeWebSocket()
    await manager.connect(good)
    await manager.broadcast({"x": 2})
    assert good.sent == [{"x": 2}]


@pytest.mark.asyncio
async def test_hall_listener_broadcasts_current_snapshot_on_demand():
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.base import Base
    from core.db.models import Console, Zone
    from tests.api.conftest import TEST_DATABASE_URL

    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as db:
        zone = Zone(name="Зал", is_active=True)
        db.add(zone)
        await db.flush()
        db.add(Console(zone_id=zone.id, name="PS5-1"))
        await db.commit()

    manager = HallConnectionManager()
    ws = _FakeWebSocket()
    await manager.connect(ws)

    listener = HallListener(manager=manager, session_factory=session_factory)
    await listener.broadcast_current_snapshot()

    await engine.dispose()

    assert len(ws.sent) == 1
    assert ws.sent[0]["consoles"][0]["name"] == "PS5-1"


@pytest.mark.asyncio
async def test_hall_listener_rebroadcasts_after_a_real_notify():
    """End to end through Postgres: a service mutation NOTIFYs, the listener's real
    LISTEN connection picks it up and pushes a fresh snapshot to the manager."""
    import asyncio

    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.api.clock import now as _now
    from core.db.base import Base
    from core.services import business_days
    from tests.api.conftest import TEST_DATABASE_URL

    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    class _SignallingWebSocket(_FakeWebSocket):
        def __init__(self) -> None:
            super().__init__()
            self.received = asyncio.Event()

        async def send_json(self, message: dict) -> None:
            await super().send_json(message)
            self.received.set()

    manager = HallConnectionManager()
    ws = _SignallingWebSocket()
    await manager.connect(ws)

    listener = HallListener(manager=manager, session_factory=session_factory)
    await listener.start()
    try:
        async with session_factory() as db:
            await business_days.open_business_day(db, opening_cash=0, now=_now())
        await asyncio.wait_for(ws.received.wait(), timeout=2)
    finally:
        await listener.stop()
        await engine.dispose()

    assert ws.sent[-1]["business_day_open"] is True


def test_websocket_rejects_unauthenticated_connection():
    from starlette.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    from core.api.main import app

    with TestClient(app) as test_client:
        # The route closes before accept(); Starlette's TestClient surfaces that
        # handshake rejection as WebSocketDisconnect carrying the close code.
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with test_client.websocket_connect("/api/ws/hall"):
                pass
    assert exc_info.value.code == 1008


def test_websocket_sends_the_initial_snapshot_once_logged_in():
    from starlette.testclient import TestClient

    from core.api.main import app

    # The route reads through core.db.session's own engine (not get_session), which
    # tests/conftest.py points at the test database — so reset that database here.
    _reset_test_db()

    with TestClient(app) as test_client:
        login = test_client.post("/api/auth/login", json={"password": "admin"})
        assert login.status_code == 200
        with test_client.websocket_connect("/api/ws/hall") as ws:
            message = ws.receive_json()
            assert message["consoles"] == []


def _reset_test_db() -> None:
    import asyncio

    from sqlalchemy.ext.asyncio import create_async_engine

    from core.db.base import Base
    from tests.api.conftest import TEST_DATABASE_URL

    async def _reset():
        engine = create_async_engine(TEST_DATABASE_URL)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await engine.dispose()

    asyncio.run(_reset())
