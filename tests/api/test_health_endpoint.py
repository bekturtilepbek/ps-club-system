import pytest
from httpx import ASGITransport, AsyncClient

from core.api.main import app
from core.db.session import get_session


@pytest.mark.asyncio
async def test_endpoint_is_public_and_reports_degraded(anonymous_client) -> None:
    response = await anonymous_client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    assert body["db"] is True and body["worker"] is False and body["backup"] is False


@pytest.mark.asyncio
async def test_endpoint_returns_503_when_db_down() -> None:
    class BrokenSession:
        async def execute(self, *_a, **_k):
            raise ConnectionError("db down")

    async def broken():
        yield BrokenSession()

    app.dependency_overrides[get_session] = broken
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/health")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json()["status"] == "down"
