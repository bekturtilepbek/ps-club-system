import pytest


@pytest.mark.asyncio
async def test_open_ticket_through_api(client):
    await client.post("/api/business-days/open", json={"opening_cash": 5000})

    response = await client.post("/api/tickets")

    assert response.status_code == 200
    body = response.json()
    assert body["console_id"] is None
    assert body["status"] == "active"
    assert body["grace_until"] is None
    assert body["charge_total"] == 0
    assert body["orders"] == []


@pytest.mark.asyncio
async def test_open_ticket_requires_auth(anonymous_client):
    response = await anonymous_client.post("/api/tickets")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_a_ticket_can_take_bar_orders_and_be_paid_and_stopped(client):
    await client.post("/api/business-days/open", json={"opening_cash": 5000})

    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.models import Product
    from tests.api.conftest import TEST_DATABASE_URL

    engine = create_async_engine(TEST_DATABASE_URL)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        water = Product(name="Вода", price=50, is_active=True)
        db.add(water)
        await db.commit()
        await db.refresh(water)
        water_id = water.id
    await engine.dispose()

    ticket = await client.post("/api/tickets")
    ticket_id = ticket.json()["id"]

    await client.post(f"/api/sessions/{ticket_id}/orders", json={"product_id": water_id, "qty": 1})
    paid = await client.post(
        f"/api/sessions/{ticket_id}/payments", json={"amount": 50, "method": "cash"}
    )
    assert paid.status_code == 200

    stopped = await client.post(f"/api/sessions/{ticket_id}/stop")
    assert stopped.status_code == 200
    assert stopped.json()["status"] == "finished"
    assert stopped.json()["balance"] == 0
