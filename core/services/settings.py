import logging
from dataclasses import dataclass
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import Setting

logger = logging.getLogger(__name__)

DEFAULT_GRACE_MINUTES = 1
DEFAULT_WARN_MINUTES = 5
DEFAULT_PLANNED_OPEN = "10:00"
DEFAULT_PLANNED_CLOSE = "05:00"
DEFAULT_DAY_REMINDER_THRESHOLD_MINUTES = 60
DEFAULT_DAY_REMINDER_INTERVAL_MINUTES = 60
MAX_CHAT_ID = 10**16  # Telegram ids fit in 52 bits; anything bigger is a typo


async def get_setting(db: AsyncSession, key: str) -> str | None:
    row = await db.get(Setting, key)
    return row.value if row else None


def _parse_int_setting(key: str, value: str | None, default: int) -> int:
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        logger.warning(
            "setting %r has a non-numeric value %r, using default %d",
            key,
            value,
            default,
        )
        return default
    if parsed < 0:
        logger.warning(
            "setting %r has a negative value %r, using default %d",
            key,
            value,
            default,
        )
        return default
    return parsed


async def get_grace_minutes(db: AsyncSession) -> int:
    value = await get_setting(db, "grace_minutes")
    return _parse_int_setting("grace_minutes", value, DEFAULT_GRACE_MINUTES)


async def get_warn_minutes(db: AsyncSession) -> int:
    value = await get_setting(db, "warn_minutes")
    return _parse_int_setting("warn_minutes", value, DEFAULT_WARN_MINUTES)


def _parse_time_setting(key: str, value: str | None, default: str) -> str:
    candidate = value if value is not None else default
    try:
        hours_str, minutes_str = candidate.split(":")
        hours, minutes = int(hours_str), int(minutes_str)
        if not (0 <= hours <= 23 and 0 <= minutes <= 59):
            raise ValueError
    except (ValueError, AttributeError):
        logger.warning(
            "setting %r has an invalid time value %r, using default %r", key, candidate, default
        )
        return default
    return f"{hours:02d}:{minutes:02d}"


async def get_planned_open(db: AsyncSession) -> str:
    value = await get_setting(db, "planned_open")
    return _parse_time_setting("planned_open", value, DEFAULT_PLANNED_OPEN)


async def get_planned_close(db: AsyncSession) -> str:
    value = await get_setting(db, "planned_close")
    return _parse_time_setting("planned_close", value, DEFAULT_PLANNED_CLOSE)


async def get_owner_chat_id(db: AsyncSession) -> int | None:
    value = await get_setting(db, "owner_chat_id")
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        logger.warning("setting 'owner_chat_id' has a non-numeric value %r, ignoring", value)
        return None


async def get_day_reminder_threshold_minutes(db: AsyncSession) -> int:
    value = await get_setting(db, "day_reminder_threshold_minutes")
    return _parse_int_setting(
        "day_reminder_threshold_minutes", value, DEFAULT_DAY_REMINDER_THRESHOLD_MINUTES
    )


async def get_day_reminder_interval_minutes(db: AsyncSession) -> int:
    value = await get_setting(db, "day_reminder_interval_minutes")
    return _parse_int_setting(
        "day_reminder_interval_minutes", value, DEFAULT_DAY_REMINDER_INTERVAL_MINUTES
    )


@dataclass(frozen=True)
class SettingSpec:
    """What the admin shows for one known setting key (label, help text, validation)."""

    key: str
    label: str
    hint: str
    kind: Literal["minutes", "time", "chat_id"]
    default: str | None
    # Upper bound for "minutes" settings: 100000 minutes of "time to pick a game" would make
    # every session free for 69 days, and nothing in the club needs more than a day.
    maximum: int | None = None


SETTING_SPECS: tuple[SettingSpec, ...] = (
    SettingSpec(
        "grace_minutes",
        "Время на выбор игры, минут",
        "Первые минуты сессии: за это время гости выбирают игру, и если уходят — сессия "
        "отменяется бесплатно. Для пакета конец сдвигается на это время.",
        "minutes",
        str(DEFAULT_GRACE_MINUTES),
        maximum=60,
    ),
    SettingSpec(
        "warn_minutes",
        "Предупреждать о конце пакета за, минут",
        "За сколько минут до конца пакета карточка консоли подсвечивается как «скоро закончится».",
        "minutes",
        str(DEFAULT_WARN_MINUTES),
        maximum=120,
    ),
    SettingSpec(
        "planned_open",
        "Плановое открытие клуба (ЧЧ:ММ)",
        "Только ориентир: день открывается и закрывается вручную.",
        "time",
        DEFAULT_PLANNED_OPEN,
    ),
    SettingSpec(
        "planned_close",
        "Плановое закрытие клуба (ЧЧ:ММ)",
        "Ориентир для предупреждения «пакет закончится после закрытия» и для напоминания "
        "о незакрытом дне. Может быть после полуночи, например 05:00.",
        "time",
        DEFAULT_PLANNED_CLOSE,
    ),
    SettingSpec(
        "owner_chat_id",
        "Telegram chat_id владельца",
        "Число. Бот отвечает только этому чату и присылает сюда итоги дня. Без значения бот "
        "молчит.",
        "chat_id",
        None,
    ),
    SettingSpec(
        "day_reminder_threshold_minutes",
        "Напомнить о незакрытом дне через, минут после планового закрытия",
        "Через сколько минут после планового закрытия бот впервые напомнит закрыть день.",
        "minutes",
        str(DEFAULT_DAY_REMINDER_THRESHOLD_MINUTES),
        maximum=24 * 60,
    ),
    SettingSpec(
        "day_reminder_interval_minutes",
        "Повторять напоминание каждые, минут",
        "Как часто бот повторяет напоминание, пока день не закрыт.",
        "minutes",
        str(DEFAULT_DAY_REMINDER_INTERVAL_MINUTES),
        maximum=24 * 60,
    ),
)

SETTING_SPECS_BY_KEY = {spec.key: spec for spec in SETTING_SPECS}


def validate_setting_value(key: str, value: str) -> str:
    """Return the value normalised for storage, or raise ValueError with a message meant
    for the operator (Russian). Unknown keys are refused: a typo would silently do nothing."""
    spec = SETTING_SPECS_BY_KEY.get(key)
    if spec is None:
        raise ValueError(f"Неизвестный параметр «{key}».")
    text = (value or "").strip()
    if spec.kind == "time":
        try:
            hours_str, minutes_str = text.split(":")
            hours, minutes = int(hours_str), int(minutes_str)
            if not (0 <= hours <= 23 and 0 <= minutes <= 59):
                raise ValueError
        except ValueError:
            raise ValueError("Время нужно писать как ЧЧ:ММ, например 10:00 или 05:30.") from None
        return f"{hours:02d}:{minutes:02d}"
    if spec.kind == "chat_id":
        try:
            chat_id = int(text)
        except ValueError:
            raise ValueError("chat_id — это число, например 123456789.") from None
        if abs(chat_id) >= MAX_CHAT_ID:
            raise ValueError("Это число слишком большое для chat_id Telegram.")
        return str(chat_id)
    try:
        minutes_value = int(text)
    except ValueError:
        raise ValueError("Нужно целое число минут, например 3.") from None
    if minutes_value < 0:
        raise ValueError("Число минут не может быть отрицательным.")
    if spec.maximum is not None and minutes_value > spec.maximum:
        raise ValueError(f"Число минут должно быть не больше {spec.maximum}.")
    return str(minutes_value)
