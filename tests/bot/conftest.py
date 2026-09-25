import pytest_asyncio

from core.db.session import engine


@pytest_asyncio.fixture(autouse=True)
async def _cleanup_engine():
    """Dispose of the global engine's connection pool after each test to prevent
    event loop lifecycle issues between tests."""
    yield
    await engine.dispose()
