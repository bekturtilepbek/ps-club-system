import os

import pytest

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test"
)


async def _seed(client):
    await client.post("/api/business-days/open", json={"opening_cash": 5000})

    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.models import Console, Product, Tariff, TariffKind, Zone

    engine = create_async_engine(TEST_DATABASE_URL)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        zone = Zone(name="Зал", is_active=True)
        db.add(zone)
        await db.flush()
        console = Console(zone_id=zone.id, name="PS5-1")
        package = Tariff(
            zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150
        )
        cola = Product(name="Кола", price=80, is_active=True)
        water = Product(name="Вода", price=50, is_active=False)
        db.add_all([console, package, cola, water])
        await db.commit()
        for obj in (console, package, cola, water):
            await db.refresh(obj)
        ids = (console.id, package.id, cola.id, water.id)
    await engine.dispose()
    return ids


@pytest.mark.asyncio
async def test_products_lists_only_active(client):
    _, _, cola_id, water_id = await _seed(client)

    response = await client.get("/api/products")

    assert response.status_code == 200
    ids = {p["id"] for p in response.json()}
    assert cola_id in ids
    assert water_id not in ids


@pytest.mark.asyncio
async def test_adding_an_order_raises_the_session_charge_total(client):
    console_id, package_id, cola_id, _ = await _seed(client)
    start = await client.post(
        "/api/sessions", json={"console_id": console_id, "tariff_id": package_id}
    )
    session_id = start.json()["id"]

    response = await client.post(
        f"/api/sessions/{session_id}/orders", json={"product_id": cola_id, "qty": 2}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["session_id"] == session_id
    assert body["product_id"] == cola_id
    assert body["qty"] == 2
    assert body["unit_price"] == 80

    session = await client.get(f"/api/sessions/{session_id}")
    assert session.json()["charge_total"] == 150 + 160
    assert len(session.json()["orders"]) == 1


@pytest.mark.asyncio
async def test_removing_an_order_lowers_the_session_charge_total(client):
    console_id, package_id, cola_id, _ = await _seed(client)
    start = await client.post(
        "/api/sessions", json={"console_id": console_id, "tariff_id": package_id}
    )
    session_id = start.json()["id"]
    order = await client.post(
        f"/api/sessions/{session_id}/orders", json={"product_id": cola_id, "qty": 1}
    )

    response = await client.delete(f"/api/orders/{order.json()['id']}")
    assert response.status_code == 204

    session = await client.get(f"/api/sessions/{session_id}")
    assert session.json()["charge_total"] == 150
    assert session.json()["orders"] == []


@pytest.mark.asyncio
async def test_products_requires_auth(anonymous_client):
    response = await anonymous_client.get("/api/products")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_products_carry_their_category(client):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.models import Product

    engine = create_async_engine(TEST_DATABASE_URL)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        db.add_all(
            [
                Product(name="Кола", price=60, is_active=True, category="Напитки"),
                Product(name="Сникерс", price=70, is_active=True),
            ]
        )
        await db.commit()
    await engine.dispose()

    products = (await client.get("/api/products")).json()
    assert {p["name"]: p["category"] for p in products} == {
        "Кола": "Напитки",
        "Сникерс": None,
    }
