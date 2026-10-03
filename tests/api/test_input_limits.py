"""Absurd input must be refused with a clear 422, never reach the database (500)."""

import pytest

HUGE = 10**12  # does not fit a 32-bit database integer


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("POST", "/api/business-days/open", {"opening_cash": -1}),
        ("POST", "/api/business-days/open", {"opening_cash": HUGE}),
        ("POST", "/api/business-days/1/close", {"counted_cash": -1}),
        ("POST", "/api/business-days/1/close", {"counted_cash": HUGE}),
        ("POST", "/api/sessions", {"console_id": HUGE, "kind": "paid", "tariff_id": 1}),
        ("POST", "/api/sessions", {"console_id": 1, "kind": "paid", "tariff_id": HUGE}),
        (
            "POST",
            "/api/sessions",
            {"console_id": 1, "kind": "paid", "tariff_id": 1, "game_id": HUGE},
        ),
        ("POST", "/api/sessions", {"console_id": 1, "kind": "free", "reason": "x" * 201}),
        ("POST", "/api/sessions", {"console_id": 1, "kind": "free", "comment": "x" * 1001}),
        ("POST", "/api/sessions/1/extend", {"tariff_id": HUGE}),
        ("POST", "/api/sessions/1/payments", {"amount": HUGE, "method": "cash"}),
        ("POST", "/api/sessions/1/payments", {"amount": 10_000_001, "method": "cash"}),
        ("POST", "/api/sessions/1/orders", {"product_id": 1, "qty": HUGE}),
        ("POST", "/api/sessions/1/orders", {"product_id": 1, "qty": 1001}),
        ("POST", "/api/sessions/1/orders", {"product_id": HUGE, "qty": 1}),
        ("GET", f"/api/sessions/{HUGE}", None),
        ("POST", f"/api/sessions/{HUGE}/stop", None),
        ("POST", f"/api/sessions/{HUGE}/cancel", None),
        ("POST", f"/api/sessions/{HUGE}/extend", {"tariff_id": 1}),
        ("POST", f"/api/sessions/{HUGE}/payments", {"amount": 10, "method": "cash"}),
        ("POST", f"/api/sessions/{HUGE}/orders", {"product_id": 1, "qty": 1}),
        ("DELETE", f"/api/orders/{HUGE}", None),
        ("GET", f"/api/business-days/{HUGE}/summary", None),
        ("GET", f"/api/business-days/{HUGE}/feed", None),
        ("POST", f"/api/business-days/{HUGE}/close", {"counted_cash": 0}),
    ],
)
async def test_absurd_input_is_a_422_not_a_server_error(client, method, path, body):
    response = await client.request(method, path, json=body)

    assert response.status_code == 422, (method, path, body, response.text[:120])


@pytest.mark.asyncio
async def test_a_free_session_with_a_blank_reason_is_refused(client):
    await client.post("/api/business-days/open", json={"opening_cash": 0})

    response = await client.post(
        "/api/sessions", json={"console_id": 1, "kind": "free", "reason": "   "}
    )

    assert response.status_code == 422
