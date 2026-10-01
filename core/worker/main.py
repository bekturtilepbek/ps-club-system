import asyncio
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.blocking import BlockingScheduler

from core import telegram
from core.config import settings
from core.db.session import async_session_factory, engine
from core.services import business_days
from core.services import health as health_service
from core.services import settings as settings_service
from core.telegram_messages import format_unclosed_day_reminder

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("worker")


def _worker_now() -> datetime:
    return datetime.now(ZoneInfo(settings.timezone))


async def _record_heartbeat_async() -> None:
    """Same fresh-event-loop caveat as _check_unclosed_day_reminder_async: dispose the
    engine every tick. A failure is logged, never raised - /api/health goes stale,
    which is exactly the signal."""
    try:
        async with async_session_factory() as db:
            await health_service.record_heartbeat(db, health_service.WORKER, _worker_now())
    except Exception:
        logger.exception("failed to record the worker heartbeat")
    finally:
        await engine.dispose()


def heartbeat() -> None:
    logger.info("worker alive at %s", _worker_now().isoformat())
    asyncio.run(_record_heartbeat_async())


async def _check_unclosed_day_reminder_async() -> None:
    """Best-effort, like core/api/routes/business_days.py's notify_day_closed —
    a DB hiccup or a Telegram outage must never crash the worker process, so the
    whole body (not just the send) is guarded.

    This runs under a fresh `asyncio.run()` every tick (see
    `check_unclosed_day_reminder` below). `core.db.session.engine` is a
    module-level singleton whose pooled asyncpg connections are bound to the
    event loop that created them — once `asyncio.run()` closes that loop, any
    connection left in the pool is unusable on the next tick's new loop. So the
    engine's pool must be disposed at the end of every tick, forcing a fresh pool
    (and fresh connections bound to the *next* loop) to be created next time. Any
    future job added to this worker that touches the DB via a fresh
    `asyncio.run()` call needs the same treatment.
    """
    now = _worker_now()
    try:
        async with async_session_factory() as db:
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
    finally:
        await engine.dispose()


def check_unclosed_day_reminder() -> None:
    asyncio.run(_check_unclosed_day_reminder_async())


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
