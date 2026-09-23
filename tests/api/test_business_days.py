import pytest


@pytest.mark.asyncio
async def test_open_then_get_current_business_day(client):
    response = await client.post("/api/business-days/open", json={"opening_cash": 5000})
    assert response.status_code == 200
    body = response.json()
    assert body["opening_cash"] == 5000
    assert body["closed_at"] is None

    current = await client.get("/api/business-days/current")
    assert current.status_code == 200
    assert current.json()["id"] == body["id"]


@pytest.mark.asyncio
async def test_opening_a_second_business_day_is_409(client):
    await client.post("/api/business-days/open", json={"opening_cash": 5000})
    response = await client.post("/api/business-days/open", json={"opening_cash": 1000})
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_current_business_day_is_404_when_none_open(client):
    response = await client.get("/api/business-days/current")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_close_business_day(client):
    opened = (await client.post("/api/business-days/open", json={"opening_cash": 5000})).json()

    closed = await client.post(
        f"/api/business-days/{opened['id']}/close", json={"counted_cash": 5000}
    )
    assert closed.status_code == 200
    assert closed.json()["expected_cash"] == 5000
