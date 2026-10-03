import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.blocking import BlockingScheduler
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from core import telegram
from core.config import settings
from core.services import business_days
from core.services import health as health_service
from core.services import settings as settings_service
from core.telegram_messages import format_unclosed_day_reminder

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("worker")


@asynccontextmanager
async def _worker_session() -> AsyncIterator[AsyncSession]:
    """A DB session on an engine that lives and dies inside the calling job.

    Every job runs under its own `asyncio.run()`, and APScheduler runs jobs on a thread
    pool, so two jobs can sit in different event loops at the same moment (the 30 s heartbeat
    and the 5 min reminder fire within a millisecond of each other every 5 minutes). Anything
    shared between them is a hazard: a pooled engine hands asyncpg connections to the wrong
    loop, and even a pool-less shared engine guards its first connection with an asyncio.Lock
    that hangs when two loops race for it. Either way one job freezes for good (APScheduler:
    "maximum number of running instances reached"). So each job builds its own NullPool engine
    and disposes it in the same loop. Any future job must use this, never the API's pooled
    `core.db.session.engine`.
    """
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            yield db
    finally:
        await engine.dispose()


# A job that never returns holds APScheduler's single slot for that job forever (the
# heartbeat or the reminder would silently stop), so a database that stops answering must
# cost one tick, not the job.
JOB_TIMEOUT_SECONDS = 25


def _run_job(name: str, job: Callable[[], Awaitable[None]]) -> None:
    try:
        asyncio.run(asyncio.wait_for(job(), timeout=JOB_TIMEOUT_SECONDS))
    except TimeoutError:
        logger.error(
            "job %s did not finish within %s s; giving up on this tick", name, JOB_TIMEOUT_SECONDS
        )


def _worker_now() -> datetime:
    return datetime.now(ZoneInfo(settings.timezone))


async def _record_heartbeat_async() -> None:
    """A failure is logged, never raised - /api/health goes stale, which is exactly the
    signal."""
    try:
        async with _worker_session() as db:
            await health_service.record_heartbeat(db, health_service.WORKER, _worker_now())
    except Exception:
        logger.exception("failed to record the worker heartbeat")


def heartbeat() -> None:
    logger.info("worker alive at %s", _worker_now().isoformat())
    _run_job("heartbeat", _record_heartbeat_async)


async def _check_unclosed_day_reminder_async() -> None:
    """Best-effort, like core/api/routes/business_days.py's notify_day_closed -
    a DB hiccup or a Telegram outage must never crash the worker process, so the
    whole body (not just the send) is guarded.

    Runs under a fresh `asyncio.run()` every tick; see `_worker_session` for why it
    must not share an engine with any other job.
    """
    now = _worker_now()
    try:
        async with _worker_session() as db:
            day = await business_days.claim_unclosed_day_reminder(db, now=now)
            if day is None:
                return
            owner_chat_id = await settings_service.get_owner_chat_id(db)
            if owner_chat_id is None:
                return
            planned_close = await settings_service.get_planned_close(db)

        text = format_unclosed_day_reminder(day, planned_close)
        await telegram.send_message(owner_chat_id, text)
    except Exception:
        logger.exception("failed to check/send the unclosed-day reminder")


def check_unclosed_day_reminder() -> None:
    _run_job("check_unclosed_day_reminder", _check_unclosed_day_reminder_async)


def main() -> None:
    scheduler = BlockingScheduler(timezone=ZoneInfo(settings.timezone))
    scheduler.add_job(heartbeat, "interval", seconds=30, id="heartbeat")
    scheduler.add_job(
        check_unclosed_day_reminder, "interval", minutes=5, id="check_unclosed_day_reminder"
    )
    logger.info("worker starting, timezone=%s", settings.timezone)
    scheduler.start()


if __name__ == "__main__":
    main()
