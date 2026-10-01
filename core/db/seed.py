import asyncio

from core.db.models import Console, Setting, Tariff, TariffKind, Zone
from core.db.session import async_session_factory


async def seed_dev_data() -> None:
    async with async_session_factory() as db:
        zone = Zone(name="Зал", is_active=True)
        db.add(zone)
        await db.flush()

        for i in range(1, 4):
            db.add(Console(zone_id=zone.id, name=f"PS5-{i}", plug_driver="manual", is_active=True))

        # Package prices are the owner's real ones. The open-time hourly rate and the package
        # names are still PLACEHOLDERS (docs/OWNER_QUESTIONS.md question 2) - fix in /admin.
        db.add(
            Tariff(
                zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=180
            )
        )
        db.add(
            Tariff(
                zone_id=zone.id,
                kind=TariffKind.package,
                name="3 часа",
                duration_min=180,
                price=420,
            )
        )
        db.add(
            Tariff(
                zone_id=zone.id,
                kind=TariffKind.package,
                name="5 часов",
                duration_min=300,
                price=600,
            )
        )
        db.add(
            Tariff(zone_id=zone.id, kind=TariffKind.open, name="Открытое время", hourly_rate=120)
        )

        db.add(Setting(key="grace_minutes", value="1"))
        db.add(Setting(key="warn_minutes", value="5"))

        await db.commit()


if __name__ == "__main__":
    asyncio.run(seed_dev_data())
