from datetime import UTC, datetime

import pytest

from core.api.routes.business_days import notify_day_closed
from core.db.models import Setting
from core.services.business_days import close_business_day, open_business_day

T = datetime(2026, 9, 25, 10, 0, tzinfo=UTC)


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


@pytest.mark.asyncio
async def test_closing_the_day_over_http_does_not_error_when_owner_chat_id_is_unset(client):
    opened = (await client.post("/api/business-days/open", json={"opening_cash": 5000})).json()

    response = await client.post(
        f"/api/business-days/{opened['id']}/close", json={"counted_cash": 5000}
    )

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_notify_day_closed_sends_nothing_when_owner_chat_id_is_unset(db_session, monkeypatch):
    sent = []

    async def fake_send_message(chat_id, text):
        sent.append((chat_id, text))

    monkeypatch.setattr("core.api.routes.business_days.telegram.send_message", fake_send_message)

    day = await open_business_day(db_session, opening_cash=5000, now=T)
    closed = await close_business_day(db_session, business_day_id=day.id, counted_cash=5000, now=T)

    await notify_day_closed(db_session, closed)

    assert sent == []


@pytest.mark.asyncio
async def test_notify_day_closed_sends_a_formatted_summary_when_owner_chat_id_is_set(
    db_session, monkeypatch
):
    sent = []

    async def fake_send_message(chat_id, text):
        sent.append((chat_id, text))

    monkeypatch.setattr("core.api.routes.business_days.telegram.send_message", fake_send_message)

    db_session.add(Setting(key="owner_chat_id", value="777"))
    await db_session.commit()
    day = await open_business_day(db_session, opening_cash=5000, now=T)
    closed = await close_business_day(db_session, business_day_id=day.id, counted_cash=5000, now=T)

    await notify_day_closed(db_session, closed)

    assert len(sent) == 1
    chat_id, text = sent[0]
    assert chat_id == 777
    assert "Итоги дня" in text


@pytest.mark.asyncio
async def test_notify_day_closed_never_raises_when_sending_fails(db_session, monkeypatch):
    async def failing_send_message(chat_id, text):
        raise RuntimeError("Telegram is down")

    monkeypatch.setattr("core.api.routes.business_days.telegram.send_message", failing_send_message)

    db_session.add(Setting(key="owner_chat_id", value="777"))
    await db_session.commit()
    day = await open_business_day(db_session, opening_cash=5000, now=T)
    closed = await close_business_day(db_session, business_day_id=day.id, counted_cash=5000, now=T)

    await notify_day_closed(db_session, closed)  # must not raise


async def test_history_list_carries_each_days_totals(client):
    opened = await client.post("/api/business-days/open", json={"opening_cash": 1000})
    assert opened.status_code == 200

    response = await client.get("/api/business-days")
    assert response.status_code == 200
    [day] = response.json()
    assert day["opening_cash"] == 1000
    for key in (
        "cash_total",
        "qr_total",
        "transfer_total",
        "sessions_count",
        "minutes_total",
        "free_minutes_total",
        "bar_sales_total",
    ):
        assert day[key] == 0


async def test_summary_exposes_free_minutes(client):
    day = (await client.post("/api/business-days/open", json={"opening_cash": 0})).json()
    summary = (await client.get(f"/api/business-days/{day['id']}/summary")).json()
    assert summary["free_minutes_total"] == 0


async def test_day_feed_endpoint(client):
    day = (await client.post("/api/business-days/open", json={"opening_cash": 0})).json()
    response = await client.get(f"/api/business-days/{day['id']}/feed")
    assert response.status_code == 200
    assert response.json() == []
    assert (await client.get("/api/business-days/999/feed")).status_code == 404
