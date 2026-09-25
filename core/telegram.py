import logging

from aiogram import Bot

from core.config import settings

logger = logging.getLogger(__name__)


async def send_message(chat_id: int, text: str) -> None:
    """The one place `api`/`worker`/`bot` reach out to Telegram from. Builds a
    short-lived Bot per call rather than sharing one across processes — sending a
    message is a single outbound HTTPS request, not a reason to add a cross-process
    channel (CLAUDE.md: don't add infrastructure without asking)."""
    if not settings.bot_token:
        logger.warning("BOT_TOKEN is not set — cannot send a Telegram message to %s", chat_id)
        return
    bot = Bot(token=settings.bot_token)
    try:
        await bot.send_message(chat_id, text)
    finally:
        await bot.session.close()
