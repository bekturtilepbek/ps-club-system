import pytest


@pytest.mark.asyncio
async def test_hall_lists_a_free_console(client):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.models import Console, Zone
    from tests.api.conftest import TEST_DATABASE_URL

    engine = create_async_engine(TEST_DATABASE_URL)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        zone = Zone(name="Зал", is_active=True)
        db.add(zone)
        await db.flush()
        db.add(Console(zone_id=zone.id, name="PS5-1"))
        await db.commit()
    await engine.dispose()

    response = await client.get("/api/hall")
    assert response.status_code == 200
    body = response.json()
    assert len(body["consoles"]) == 1
    assert body["consoles"][0]["session"] is None
    assert body["business_day_open"] is False


@pytest.mark.asyncio
async def test_hall_includes_an_active_session(client):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.models import Console, Tariff, TariffKind, Zone
    from tests.api.conftest import TEST_DATABASE_URL

    engine = create_async_engine(TEST_DATABASE_URL)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        zone = Zone(name="Зал", is_active=True)
        db.add(zone)
        await db.flush()
        console = Console(zone_id=zone.id, name="PS5-1")
        tariff = Tariff(
            zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150
        )
        db.add_all([console, tariff])
        await db.commit()
        await db.refresh(console)
        await db.refresh(tariff)
        console_id, tariff_id = console.id, tariff.id
    await engine.dispose()

    await client.post("/api/business-days/open", json={"opening_cash": 0})
    await client.post("/api/sessions", json={"console_id": console_id, "tariff_id": tariff_id})

    response = await client.get("/api/hall")
    body = response.json()
    assert body["business_day_open"] is True
    console_view = next(c for c in body["consoles"] if c["id"] == console_id)
    assert console_view["session"]["status"] == "active"
    assert console_view["charge_total"] == 150


@pytest.mark.asyncio
async def test_hall_lists_an_open_ticket_separately_from_consoles(client):
    await client.post("/api/business-days/open", json={"opening_cash": 0})
    ticket = await client.post("/api/tickets")
    ticket_id = ticket.json()["id"]

    response = await client.get("/api/hall")

    assert response.status_code == 200
    body = response.json()
    assert body["consoles"] == []
    assert len(body["tickets"]) == 1
    assert body["tickets"][0]["id"] == ticket_id
    assert body["tickets"][0]["console_id"] is None
