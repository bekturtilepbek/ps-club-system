"""Two tills, a tablet and a double tap act on the same session at the same moment.

Each call gets its own connection, like each HTTP request does in production.
"""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from core.db.models import (
    AuditLog,
    Console,
    SegmentKind,
    SessionKind,
    SessionSegment,
    SessionStatus,
    Tariff,
    TariffKind,
    Zone,
)
from core.db.models import Session as SessionModel
from core.services.business_days import open_business_day
from core.services.errors import ConflictError
from core.services.sessions import cancel_session, extend_session, start_session, stop_session

T = datetime(2026, 10, 3, 12, 0, 0, tzinfo=UTC)
PARALLEL_CALLS = 12


@pytest.fixture
def connect(db_session):
    return async_sessionmaker(db_session.bind, expire_on_commit=False)


async def _started_session(db_session, connect, *, tariff_kind=TariffKind.package):
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    console = Console(zone_id=zone.id, name="PS5-1")
    package = Tariff(
        zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150
    )
    open_tariff = Tariff(
        zone_id=zone.id, kind=TariffKind.open, name="Открытое время", hourly_rate=120
    )
    db_session.add_all([console, package, open_tariff])
    await db_session.flush()
    await open_business_day(db_session, opening_cash=0, now=T - timedelta(hours=1))
    await db_session.commit()
    async with connect() as db:
        session = await start_session(
            db,
            console_id=console.id,
            kind=SessionKind.paid,
            tariff_id=package.id if tariff_kind == TariffKind.package else open_tariff.id,
            reason=None,
            comment=None,
            now=T,
        )
        return session.id, package.id


async def _in_parallel(connect, action):
    async def one():
        async with connect() as db:
            return await action(db)

    return await asyncio.gather(*[one() for _ in range(PARALLEL_CALLS)], return_exceptions=True)


@pytest.mark.asyncio
async def test_parallel_extensions_are_chained_one_after_another_never_overlapping(
    db_session, connect
):
    session_id, package_id = await _started_session(db_session, connect)

    results = await _in_parallel(
        connect,
        lambda db: extend_session(
            db, session_id=session_id, tariff_id=package_id, now=T + timedelta(minutes=5)
        ),
    )

    assert [r for r in results if isinstance(r, Exception)] == []
    async with connect() as db:
        segments = (
            (
                await db.execute(
                    select(SessionSegment)
                    .where(SessionSegment.session_id == session_id)
                    .order_by(SessionSegment.starts_at, SessionSegment.id)
                )
            )
            .scalars()
            .all()
        )
    assert len(segments) == PARALLEL_CALLS + 1
    for previous, current in zip(segments, segments[1:], strict=False):
        assert (
            current.starts_at == previous.ends_at
        ), "a guest would be billed twice for the same hour"


@pytest.mark.asyncio
async def test_only_one_of_many_parallel_stops_succeeds(db_session, connect):
    session_id, _ = await _started_session(db_session, connect, tariff_kind=TariffKind.open)

    results = await _in_parallel(
        connect,
        lambda db: stop_session(db, session_id=session_id, now=T + timedelta(minutes=30)),
    )

    assert sum(1 for r in results if isinstance(r, SessionModel)) == 1
    assert all(isinstance(r, ConflictError) for r in results if not isinstance(r, SessionModel))
    async with connect() as db:
        session = await db.get(SessionModel, session_id)
        assert session.status == SessionStatus.finished
        open_segment = next(s for s in session.segments if s.kind == SegmentKind.open)
        assert open_segment.ends_at == T + timedelta(minutes=30)


@pytest.mark.asyncio
async def test_only_one_of_many_parallel_cancels_succeeds_and_is_audited_once(db_session, connect):
    session_id, _ = await _started_session(db_session, connect)

    results = await _in_parallel(
        connect,
        lambda db: cancel_session(db, session_id=session_id, now=T + timedelta(seconds=20)),
    )

    assert sum(1 for r in results if isinstance(r, SessionModel)) == 1
    async with connect() as db:
        audited = await db.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.action == "cancel")
        )
    assert audited == 1
