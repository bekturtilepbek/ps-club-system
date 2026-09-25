import pytest
from sqlalchemy import inspect

from core.db.models import Console, Tariff, TariffKind, Zone


def test_console_has_a_zone_relationship():
    assert "zone" in inspect(Console).relationships.keys()


def test_tariff_has_a_zone_relationship():
    assert "zone" in inspect(Tariff).relationships.keys()


@pytest.mark.asyncio
async def test_console_zone_relationship_loads_the_related_zone(db_session):
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    console = Console(zone_id=zone.id, name="PS5-1")
    db_session.add(console)
    await db_session.commit()
    await db_session.refresh(console, attribute_names=["zone"])

    assert console.zone.name == "Зал"


@pytest.mark.asyncio
async def test_tariff_zone_relationship_loads_the_related_zone(db_session):
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    tariff = Tariff(
        zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150
    )
    db_session.add(tariff)
    await db_session.commit()
    await db_session.refresh(tariff, attribute_names=["zone"])

    assert tariff.zone.name == "Зал"
