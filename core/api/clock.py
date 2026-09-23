from datetime import datetime
from zoneinfo import ZoneInfo

from core.config import settings


def now() -> datetime:
    return datetime.now(ZoneInfo(settings.timezone))
