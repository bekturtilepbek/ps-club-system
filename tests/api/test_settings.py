import pytest


@pytest.mark.asyncio
async def test_settings_returns_defaults_when_unset(client):
    response = await client.get("/api/settings")
    assert response.status_code == 200
    assert response.json() == {"grace_minutes": 3, "warn_minutes": 5}


@pytest.mark.asyncio
async def test_settings_reflects_configured_values(client):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.models import Setting
    from tests.api.conftest import TEST_DATABASE_URL

    engine = create_async_engine(TEST_DATABASE_URL)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        db.add(Setting(key="grace_minutes", value="4"))
        db.add(Setting(key="warn_minutes", value="7"))
        await db.commit()
    await engine.dispose()

    response = await client.get("/api/settings")
    assert response.json() == {"grace_minutes": 4, "warn_minutes": 7}
