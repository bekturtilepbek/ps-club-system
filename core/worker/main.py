import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.blocking import BlockingScheduler

from core.config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("worker")


def heartbeat() -> None:
    now = datetime.now(ZoneInfo(settings.timezone))
    logger.info("worker alive at %s", now.isoformat())


def main() -> None:
    scheduler = BlockingScheduler(timezone=ZoneInfo(settings.timezone))
    scheduler.add_job(heartbeat, "interval", seconds=30, id="heartbeat")
    logger.info("worker starting, timezone=%s", settings.timezone)
    scheduler.start()


if __name__ == "__main__":
    main()
