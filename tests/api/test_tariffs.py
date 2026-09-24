import pytest


async def _seed_tariffs(db):
    from core.db.models import Tariff, TariffKind, Zone

    zone = Zone(name="Зал", is_active=True)
    db.add(zone)
    await db.flush()
    db.add(Tariff(zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150))
    db.add(Tariff(zone_id=zone.id, kind=TariffKind.open, name="Открытое время", hourly_rate=120))
    db.add(
        Tariff(
            zone_id=zone.id, kind=TariffKind.package, name="Старый", duration_min=30,
            price=100, is_active=False,
        )
    )


@pytest.mark.asyncio
async def test_tariffs_lists_only_active(client):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from tests.api.conftest import TEST_DATABASE_URL

    engine = create_async_engine(TEST_DATABASE_URL)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        await _seed_tariffs(db)
        await db.commit()
    await engine.dispose()

    response = await client.get("/api/tariffs")
    assert response.status_code == 200
    names = {t["name"] for t in response.json()}
    assert names == {"1 час", "Открытое время"}
