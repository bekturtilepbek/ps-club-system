import pytest


@pytest.mark.asyncio
async def test_health_does_not_require_auth(anonymous_client):
    response = await anonymous_client.get("/api/health")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_starting_a_session_requires_auth(anonymous_client):
    response = await anonymous_client.post("/api/sessions", json={"console_id": 1})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_business_days_requires_auth(anonymous_client):
    response = await anonymous_client.get("/api/business-days/current")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_settings_requires_auth(anonymous_client):
    response = await anonymous_client.get("/api/settings")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_tariffs_requires_auth(anonymous_client):
    response = await anonymous_client.get("/api/tariffs")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_logged_in_client_can_reach_protected_routes(client):
    response = await client.get("/api/settings")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_hall_requires_auth(anonymous_client):
    response = await anonymous_client.get("/api/hall")
    assert response.status_code == 401
