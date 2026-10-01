import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from core.services import health as health_service

NOW = datetime(2026, 10, 1, 12, 0, tzinfo=ZoneInfo("Asia/Bishkek"))


def _touch_dump(directory, age: timedelta) -> None:
    path = directory / "psclub-test.sql.gz"
    path.write_bytes(b"x")
    mtime = (NOW - age).timestamp()
    os.utime(path, (mtime, mtime))


@pytest.mark.asyncio
async def test_check_ok_when_worker_and_backup_fresh(db_session, tmp_path) -> None:
    await health_service.record_heartbeat(
        db_session, health_service.WORKER, NOW - timedelta(seconds=20)
    )
    _touch_dump(tmp_path, timedelta(minutes=30))

    report = await health_service.check(db_session, now=NOW, backup_dir=tmp_path)

    assert (report.status, report.db, report.worker, report.backup) == ("ok", True, True, True)


@pytest.mark.asyncio
async def test_check_degraded_without_heartbeat_or_backup(db_session, tmp_path) -> None:
    report = await health_service.check(db_session, now=NOW, backup_dir=tmp_path)

    assert (report.status, report.db, report.worker, report.backup) == (
        "degraded",
        True,
        False,
        False,
    )
    assert report.worker_last_beat_at is None and report.last_backup_at is None


@pytest.mark.asyncio
async def test_check_degraded_when_worker_and_backup_stale(db_session, tmp_path) -> None:
    await health_service.record_heartbeat(
        db_session, health_service.WORKER, NOW - timedelta(minutes=10)
    )
    _touch_dump(tmp_path, timedelta(hours=5))

    report = await health_service.check(db_session, now=NOW, backup_dir=tmp_path)

    assert (report.status, report.worker, report.backup) == ("degraded", False, False)


@pytest.mark.asyncio
async def test_record_heartbeat_upserts(db_session) -> None:
    await health_service.record_heartbeat(
        db_session, health_service.WORKER, NOW - timedelta(minutes=1)
    )
    await health_service.record_heartbeat(db_session, health_service.WORKER, NOW)

    beat = await db_session.get(health_service.ServiceHeartbeat, health_service.WORKER)
    await db_session.refresh(beat)
    assert beat.beat_at == NOW


@pytest.mark.asyncio
async def test_missing_backup_dir_is_not_an_error(db_session, tmp_path) -> None:
    report = await health_service.check(db_session, now=NOW, backup_dir=tmp_path / "nope")

    assert report.last_backup_at is None and report.db is True
