import os
from collections.abc import AsyncGenerator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.api.main import app
from core.db.base import Base
from core.db.models import *  # noqa: F401,F403
from core.db.session import get_session

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test"
)


async def _build_client(*, auto_login: bool) -> AsyncGenerator[AsyncClient, None]:
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_session():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        if auto_login:
            await ac.post("/api/auth/login", json={"password": "admin"})
        yield ac

    app.dependency_overrides.clear()
    await engine.dispose()


@pytest_asyncio.fixture
async def client():
    """Authenticated client — every Stage 2 test and most Stage 3 tests use this."""
    async for ac in _build_client(auto_login=True):
        yield ac


@pytest_asyncio.fixture
async def anonymous_client():
    """Not logged in — for asserting protected routes reject unauthenticated requests."""
    async for ac in _build_client(auto_login=False):
        yield ac
