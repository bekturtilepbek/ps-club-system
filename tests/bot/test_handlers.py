from datetime import UTC, datetime, timedelta

import pytest

from bot.handlers import build_hall_status_text
from core.db.models import Console, SessionKind, Tariff, TariffKind, Zone
from core.services import business_days, sessions

T = datetime(2026, 9, 25, 10, 0, tzinfo=UTC)


@pytest.mark.asyncio
async def test_build_hall_status_text_lists_a_busy_console_and_a_free_one(db_session):
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    busy = Console(zone_id=zone.id, name="PS5-1")
    free = Console(zone_id=zone.id, name="PS5-2")
    tariff = Tariff(
        zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150
    )
    db_session.add_all([busy, free, tariff])
    await db_session.flush()

    await business_days.open_business_day(db_session, opening_cash=0, now=T)
    await sessions.start_session(
        db_session,
        console_id=busy.id,
        kind=SessionKind.paid,
        tariff_id=tariff.id,
        reason=None,
        comment=None,
        now=T,
    )

    text = await build_hall_status_text(db_session, T + timedelta(minutes=10))

    assert "занято 1 из 2" in text
    assert "PS5-1" in text
    assert "PS5-2" in text
