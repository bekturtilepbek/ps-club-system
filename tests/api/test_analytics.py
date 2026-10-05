import pytest

from tests.api.test_full_cycle import _seed_reference_data

RANGE = {"from": "2026-01-01", "to": "2099-01-01"}  # clamped by the server to [first day, today]


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["summary", "revenue", "load", "bar", "games"])
async def test_every_endpoint_requires_a_login(anonymous_client, path):
    response = await anonymous_client.get(f"/api/analytics/{path}", params=RANGE)
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_a_reversed_range_is_rejected(client):
    response = await client.get(
        "/api/analytics/summary", params={"from": "2026-09-10", "to": "2026-09-01"}
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_a_huge_range_is_clamped_to_the_data_span(client):
    await client.post("/api/business-days/open", json={"opening_cash": 0})
    huge = {"from": "1900-01-01", "to": "2099-01-01"}

    summary = await client.get("/api/analytics/summary", params=huge)
    assert summary.status_code == 200

    revenue = await client.get("/api/analytics/revenue", params={**huge, "group": "day"})
    assert revenue.status_code == 200
    body = revenue.json()
    assert len(body["points"]) == 1
    assert body["date_from"] == body["date_to"] == body["points"][0]["period_start"]


@pytest.mark.asyncio
async def test_an_empty_database_returns_zeros_not_errors(client):
    summary = (await client.get("/api/analytics/summary", params=RANGE)).json()
    assert summary["current"]["revenue_total"] == 0
    assert summary["current"]["avg_check"] is None
    assert summary["changes"]["revenue_total"] is None

    load = (await client.get("/api/analytics/load", params=RANGE)).json()
    assert len(load["cells"]) == 168
    assert len(load["hourly"]) == 24
    assert load["quietest"] is None and load["busiest"] is None

    for path in ("bar", "games"):
        assert (await client.get(f"/api/analytics/{path}", params=RANGE)).json()["rows"] == []
    assert (
        await client.get("/api/analytics/revenue", params={**RANGE, "group": "month"})
    ).status_code == 200


@pytest.mark.asyncio
async def test_a_real_session_shows_up_in_every_report(client):
    console_id, package_id, _ = await _seed_reference_data()
    await client.post("/api/business-days/open", json={"opening_cash": 0})
    session = (
        await client.post("/api/sessions", json={"console_id": console_id, "tariff_id": package_id})
    ).json()
    await client.post(f"/api/sessions/{session['id']}/stop")
    await client.post(
        f"/api/sessions/{session['id']}/payments", json={"amount": 150, "method": "cash"}
    )

    summary = (await client.get("/api/analytics/summary", params=RANGE)).json()
    assert summary["current"]["cash_total"] == 150
    assert summary["current"]["transfer_total"] == 0
    assert summary["current"]["paid_sessions_count"] == 1
    assert summary["includes_open_day"] is True

    revenue = (await client.get("/api/analytics/revenue", params=RANGE)).json()
    assert sum(point["cash_total"] for point in revenue["points"]) == 150

    games = (await client.get("/api/analytics/games", params=RANGE)).json()
    assert games["rows"][0]["sessions"] == 1 and games["rows"][0]["name"] is None
