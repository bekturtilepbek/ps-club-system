import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.api.clock import now as _now
from core.db.base import Base
from core.db.models import Console, SessionKind, Tariff, TariffKind, Zone
from core.services import business_days, hall, sessions
from tests.api.conftest import TEST_DATABASE_URL


@pytest.mark.asyncio
async def test_build_hall_snapshot_lists_free_and_active_consoles():
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as db:
        zone = Zone(name="Зал", is_active=True)
        db.add(zone)
        await db.flush()
        free_console = Console(zone_id=zone.id, name="PS5-1")
        busy_console = Console(zone_id=zone.id, name="PS5-2")
        tariff = Tariff(
            zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150
        )
        db.add_all([free_console, busy_console, tariff])
        await db.flush()

        now = _now()
        await business_days.open_business_day(db, opening_cash=0, now=now)
        await sessions.start_session(
            db,
            console_id=busy_console.id,
            kind=SessionKind.paid,
            tariff_id=tariff.id,
            reason=None,
            comment=None,
            now=now,
        )

        snapshot = await hall.build_hall_snapshot(db, now)

    await engine.dispose()

    assert snapshot.business_day_open is True
    by_name = {c.name: c for c in snapshot.consoles}
    assert by_name["PS5-1"].session is None
    assert by_name["PS5-1"].charge_total == 0
    assert by_name["PS5-2"].session is not None
    assert by_name["PS5-2"].charge_total == 150
    assert by_name["PS5-2"].balance == 150


@pytest.mark.asyncio
async def test_build_hall_snapshot_lists_walk_in_tickets_separately_from_consoles():
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as db:
        now = _now()
        await business_days.open_business_day(db, opening_cash=0, now=now)
        ticket = await sessions.open_ticket(db, now=now)

        snapshot = await hall.build_hall_snapshot(db, now)

    await engine.dispose()

    assert snapshot.consoles == []
    assert len(snapshot.tickets) == 1
    assert snapshot.tickets[0].session.id == ticket.id
    assert snapshot.tickets[0].charge_total == 0
    assert snapshot.tickets[0].balance == 0


@pytest.mark.asyncio
async def test_hall_snapshot_carries_the_open_business_day_id():
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as db:
        now = _now()
        day = await business_days.open_business_day(db, opening_cash=0, now=now)

        snapshot = await hall.build_hall_snapshot(db, now)

    await engine.dispose()

    assert snapshot.business_day_id == day.id


@pytest.mark.asyncio
async def test_hall_snapshot_business_day_id_is_none_when_no_day_open():
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as db:
        now = _now()

        snapshot = await hall.build_hall_snapshot(db, now)

    await engine.dispose()

    assert snapshot.business_day_id is None
