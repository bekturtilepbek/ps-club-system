import os

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test"
)

# Point the app's own engine (core.db.session) and the hall LISTEN connection
# (core.api.ws.listener) at the test database too. Must run before anything imports
# core.config: Settings is read once at import time, and a real DATABASE_URL from
# the environment or .env must never be touched by the test suite.
os.environ["DATABASE_URL"] = TEST_DATABASE_URL

import pytest_asyncio  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from core.db.base import Base  # noqa: E402
from core.db.models import *  # noqa: E402,F401,F403 — registers every model on Base.metadata


@pytest_asyncio.fixture
async def db_session():
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session

    await engine.dispose()
