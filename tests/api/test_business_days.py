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


@pytest.mark.asyncio
async def test_business_day_summary(client):
    opened = (await client.post("/api/business-days/open", json={"opening_cash": 5000})).json()

    response = await client.get(f"/api/business-days/{opened['id']}/summary")

    assert response.status_code == 200
    body = response.json()
    assert body["opening_cash"] == 5000
    assert body["expected_cash"] == 5000
    assert body["has_active_sessions"] is False


@pytest.mark.asyncio
async def test_business_day_summary_of_unknown_day_is_404(client):
    response = await client.get("/api/business-days/999/summary")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_list_business_days(client):
    opened = (await client.post("/api/business-days/open", json={"opening_cash": 5000})).json()
    await client.post(f"/api/business-days/{opened['id']}/close", json={"counted_cash": 5000})

    response = await client.get("/api/business-days")

    assert response.status_code == 200
    ids = [d["id"] for d in response.json()]
    assert opened["id"] in ids


@pytest.mark.asyncio
async def test_list_business_days_rejects_an_out_of_range_limit(client):
    response = await client.get("/api/business-days?limit=-1")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_list_business_days_rejects_a_limit_over_365(client):
    response = await client.get("/api/business-days?limit=400")
    assert response.status_code == 422
