import os

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.db.models import Console, Tariff, TariffKind, Zone

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test"
)


async def _seed_reference_data():
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
        open_tariff = Tariff(
            zone_id=zone.id, kind=TariffKind.open, name="Открытое время", hourly_rate=120
        )
        db.add_all([console, package, open_tariff])
        await db.commit()
        await db.refresh(console)
        await db.refresh(package)
        await db.refresh(open_tariff)
        ids = (console.id, package.id, open_tariff.id)
    await engine.dispose()
    return ids


@pytest.mark.asyncio
async def test_full_session_cycle_through_the_api(client):
    console_id, package_id, open_id = await _seed_reference_data()

    day = (await client.post("/api/business-days/open", json={"opening_cash": 5000})).json()

    # start a package
    started = await client.post(
        "/api/sessions", json={"console_id": console_id, "tariff_id": package_id}
    )
    assert started.status_code == 200
    session_id = started.json()["id"]
    assert started.json()["segments"][0]["kind"] == "package"
    assert started.json()["charge_total"] == 150

    # extend with open time
    extended = await client.post(f"/api/sessions/{session_id}/extend", json={"tariff_id": open_id})
    assert extended.status_code == 200
    segments = extended.json()["segments"]
    assert len(segments) == 2
    assert segments[1]["kind"] == "open"
    # chains at the package's end, SPEC 3.2
    assert segments[1]["starts_at"] == segments[0]["ends_at"]

    # stop
    stopped = await client.post(f"/api/sessions/{session_id}/stop")
    assert stopped.status_code == 200
    assert stopped.json()["status"] == "finished"
    assert stopped.json()["segments"][1]["ends_at"] is not None
    balance_due = stopped.json()["balance"]
    # balance_due may equal exactly 150 here — the extend/stop calls happen within
    # milliseconds of each other in real time, well before the package's
    # grace-adjusted end, so the open segment's billable window is ~0; that's
    # correct per SPEC 3.2's elapsed-time rule, not a bug
    assert balance_due >= 150

    # split payment: cash, then a transfer for the remainder
    first_payment = balance_due // 2
    remainder = balance_due - first_payment
    pay1 = await client.post(
        f"/api/sessions/{session_id}/payments",
        json={"amount": first_payment, "method": "cash"},
    )
    assert pay1.status_code == 200
    pay2 = await client.post(
        f"/api/sessions/{session_id}/payments",
        json={"amount": remainder, "method": "transfer"},
    )
    assert pay2.status_code == 200

    final = await client.get(f"/api/sessions/{session_id}")
    assert final.json()["balance"] == 0
    assert final.json()["paid_total"] == balance_due

    # the day's revenue is everything received, both methods together (and each still apart)
    summary = (await client.get(f"/api/business-days/{day['id']}/summary")).json()
    assert summary["cash_total"] == first_payment
    assert summary["transfer_total"] == remainder
    assert summary["revenue_total"] == balance_due
    [history_row] = (await client.get("/api/business-days")).json()
    assert history_row["revenue_total"] == balance_due
