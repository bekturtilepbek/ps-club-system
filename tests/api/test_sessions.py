import pytest


async def _setup(client):
    await client.post("/api/business-days/open", json={"opening_cash": 5000})
    # SQLAdmin isn't wired in yet (Task 16) — insert reference data straight through the ORM
    # via the same DB the `client` fixture points at is not available here, so this test
    # seeds through a second, direct DB connection instead.
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.models import Console, Tariff, TariffKind, Zone

    engine = create_async_engine("postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        zone = Zone(name="Зал", is_active=True)
        db.add(zone)
        await db.flush()
        console = Console(zone_id=zone.id, name="PS5-1")
        package = Tariff(
            zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150
        )
        db.add_all([console, package])
        await db.commit()
        await db.refresh(console)
        await db.refresh(package)
        console_id, package_id = console.id, package.id
    await engine.dispose()
    return console_id, package_id


@pytest.mark.asyncio
async def test_start_session_through_api(client):
    console_id, package_id = await _setup(client)

    response = await client.post(
        "/api/sessions", json={"console_id": console_id, "tariff_id": package_id}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "active"
    assert body["charge_total"] == 150
    assert body["balance"] == 150


@pytest.mark.asyncio
async def test_starting_a_session_without_an_open_business_day_is_409(client):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.models import Console, Tariff, TariffKind, Zone

    engine = create_async_engine("postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        zone = Zone(name="Зал", is_active=True)
        db.add(zone)
        await db.flush()
        console = Console(zone_id=zone.id, name="PS5-1")
        package = Tariff(
            zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150
        )
        db.add_all([console, package])
        await db.commit()
        await db.refresh(console)
        await db.refresh(package)
        console_id, package_id = console.id, package.id
    await engine.dispose()

    response = await client.post(
        "/api/sessions", json={"console_id": console_id, "tariff_id": package_id}
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_paying_a_non_positive_amount_is_422(client):
    console_id, package_id = await _setup(client)
    started = await client.post(
        "/api/sessions", json={"console_id": console_id, "tariff_id": package_id}
    )
    session_id = started.json()["id"]

    response = await client.post(
        f"/api/sessions/{session_id}/payments", json={"amount": 0, "method": "cash"}
    )
    assert response.status_code == 422
