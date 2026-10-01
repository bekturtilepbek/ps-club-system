"""Liveness checks behind /api/health.

The worker and backup container are separate processes, so their state is read from
shared storage: a heartbeat row in Postgres for the worker, the newest dump file on the
read-only backup volume for backups.
"""

from dataclasses import dataclass
from datetime import datetime, tzinfo
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models.heartbeat import ServiceHeartbeat

WORKER = "worker"
WORKER_STALE_SECONDS = 120  # heartbeat job runs every 30 s
BACKUP_STALE_SECONDS = 3 * 60 * 60  # dumps are hourly


@dataclass(frozen=True)
class HealthReport:
    status: str  # "ok" | "degraded" | "down"
    db: bool
    worker: bool
    backup: bool
    worker_last_beat_at: datetime | None
    last_backup_at: datetime | None


async def record_heartbeat(db: AsyncSession, name: str, now: datetime) -> None:
    stmt = insert(ServiceHeartbeat).values(name=name, beat_at=now)
    await db.execute(
        stmt.on_conflict_do_update(index_elements=["name"], set_={"beat_at": stmt.excluded.beat_at})
    )
    await db.commit()


def latest_backup_at(backup_dir: Path, tz: tzinfo | None) -> datetime | None:
    try:
        mtimes = [p.stat().st_mtime for p in backup_dir.glob("*.sql.gz")]
    except OSError:
        return None
    return datetime.fromtimestamp(max(mtimes), tz) if mtimes else None


async def check(db: AsyncSession, *, now: datetime, backup_dir: Path) -> HealthReport:
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        return HealthReport("down", False, False, False, None, None)

    beat = await db.get(ServiceHeartbeat, WORKER)
    worker_at = beat.beat_at if beat else None
    worker_ok = worker_at is not None and (now - worker_at).total_seconds() < WORKER_STALE_SECONDS

    backup_at = latest_backup_at(backup_dir, now.tzinfo)
    backup_ok = backup_at is not None and (now - backup_at).total_seconds() < BACKUP_STALE_SECONDS

    status = "ok" if worker_ok and backup_ok else "degraded"
    return HealthReport(status, True, worker_ok, backup_ok, worker_at, backup_at)
