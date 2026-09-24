import asyncio
from datetime import timedelta

import asyncpg
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.api.clock import now as _now
from core.db.base import Base
from core.db.models import Console, PaymentMethod, SessionKind, Tariff, TariffKind, Zone
from core.services import business_days, payments, sessions
from tests.api.conftest import TEST_DATABASE_URL


def _asyncpg_dsn(sqlalchemy_url: str) -> str:
    return sqlalchemy_url.replace("postgresql+asyncpg://", "postgresql://", 1)


async def _fresh_db():
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _seed_console_and_tariff(db) -> tuple[Console, Tariff]:
    zone = Zone(name="Зал", is_active=True)
    db.add(zone)
    await db.flush()
    console = Console(zone_id=zone.id, name="PS5-1")
    tariff = Tariff(
        zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150
    )
    db.add_all([console, tariff])
    await db.flush()
    return console, tariff


@pytest.mark.asyncio
async def test_starting_a_session_sends_hall_changed_notification():
    engine, session_factory = await _fresh_db()
    listener_conn = await asyncpg.connect(_asyncpg_dsn(TEST_DATABASE_URL))
    received = asyncio.Event()

    def _on_notify(*_args):
        received.set()

    async with session_factory() as db:
        console, tariff = await _seed_console_and_tariff(db)
        now = _now()
        await business_days.open_business_day(db, opening_cash=0, now=now)

        # LISTEN only after the day is open: open_business_day NOTIFYs too, and must
        # not be what satisfies this test.
        await listener_conn.add_listener("hall_changed", _on_notify)
        await sessions.start_session(
            db,
            console_id=console.id,
            kind=SessionKind.paid,
            tariff_id=tariff.id,
            reason=None,
            comment=None,
            now=now,
        )

    await asyncio.wait_for(received.wait(), timeout=2)

    await listener_conn.remove_listener("hall_changed", _on_notify)
    await listener_conn.close()
    await engine.dispose()


@pytest.mark.asyncio
async def test_every_hall_mutation_sends_a_notification():
    engine, session_factory = await _fresh_db()
    listener_conn = await asyncpg.connect(_asyncpg_dsn(TEST_DATABASE_URL))
    received: list[str] = []
    await listener_conn.add_listener("hall_changed", lambda *_args: received.append("x"))

    async def expect_notifications(count: int, step: str) -> None:
        async def _wait() -> None:
            while len(received) < count:
                await asyncio.sleep(0.01)

        try:
            await asyncio.wait_for(_wait(), timeout=2)
        except TimeoutError:
            pytest.fail(f"{step} did not send NOTIFY hall_changed")

    try:
        async with session_factory() as db:
            console, tariff = await _seed_console_and_tariff(db)
            await db.commit()
            now = _now()

            day = await business_days.open_business_day(db, opening_cash=0, now=now)
            await expect_notifications(1, "open_business_day")

            played = await sessions.start_session(
                db,
                console_id=console.id,
                kind=SessionKind.paid,
                tariff_id=tariff.id,
                reason=None,
                comment=None,
                now=now,
            )
            await expect_notifications(2, "start_session")

            later = now + timedelta(minutes=10)
            await sessions.extend_session(db, session_id=played.id, tariff_id=tariff.id, now=later)
            await expect_notifications(3, "extend_session")

            await payments.add_payment(
                db, session_id=played.id, amount=300, method=PaymentMethod.cash, now=later
            )
            await expect_notifications(4, "add_payment")

            await sessions.stop_session(db, session_id=played.id, now=later)
            await expect_notifications(5, "stop_session")

            cancelled = await sessions.start_session(
                db,
                console_id=console.id,
                kind=SessionKind.paid,
                tariff_id=tariff.id,
                reason=None,
                comment=None,
                now=later,
            )
            await expect_notifications(6, "start_session (second)")

            await sessions.cancel_session(db, session_id=cancelled.id, now=later)
            await expect_notifications(7, "cancel_session")

            await business_days.close_business_day(
                db, business_day_id=day.id, counted_cash=300, now=later
            )
            await expect_notifications(8, "close_business_day")
    finally:
        await listener_conn.close()
        await engine.dispose()
