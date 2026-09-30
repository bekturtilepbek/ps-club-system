from datetime import UTC, datetime, timedelta

from core.db.models import BusinessDay, Console, Session, SessionKind, SessionStatus, Zone
from core.services.hall import build_hall_snapshot

T = datetime(2026, 9, 29, 4, 0, 0, tzinfo=UTC)  # 10:00 in Bishkek


async def _console(db_session, zone_id: int, name: str) -> Console:
    console = Console(zone_id=zone_id, name=name)
    db_session.add(console)
    await db_session.flush()
    return console


async def test_free_since_counts_from_the_last_session_but_not_before_the_day(db_session):
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    used_today = await _console(db_session, zone.id, "PS 1")
    await _console(db_session, zone.id, "PS 2")  # never used
    used_yesterday = await _console(db_session, zone.id, "PS 3")
    busy = await _console(db_session, zone.id, "PS 4")

    yesterday = BusinessDay(
        opened_at=T - timedelta(days=1), closed_at=T - timedelta(hours=5), opening_cash=0
    )
    today = BusinessDay(opened_at=T, opening_cash=0)
    db_session.add_all([yesterday, today])
    await db_session.flush()

    def session(
        console: Console, day: BusinessDay, *, started: datetime, ended: datetime | None
    ) -> Session:
        return Session(
            console_id=console.id,
            business_day_id=day.id,
            kind=SessionKind.paid,
            status=SessionStatus.active if ended is None else SessionStatus.finished,
            started_at=started,
            grace_until=started,
            ended_at=ended,
        )

    db_session.add_all(
        [
            session(
                used_today, today, started=T + timedelta(minutes=30), ended=T + timedelta(hours=2)
            ),
            session(
                used_yesterday,
                yesterday,
                started=T - timedelta(hours=8),
                ended=T - timedelta(hours=6),
            ),
            session(busy, today, started=T + timedelta(hours=1), ended=None),
        ]
    )
    await db_session.commit()

    snapshot = await build_hall_snapshot(db_session, T + timedelta(hours=3))
    free_since = {view.name: view.free_since for view in snapshot.consoles}

    assert free_since["PS 1"] == T + timedelta(hours=2)
    assert free_since["PS 2"] == T
    assert free_since["PS 3"] == T  # yesterday's end is before today opened
    assert free_since["PS 4"] is None


async def test_free_since_is_empty_while_no_day_is_open(db_session):
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    await _console(db_session, zone.id, "PS 1")
    await db_session.commit()

    snapshot = await build_hall_snapshot(db_session, T)
    assert snapshot.consoles[0].free_since is None
