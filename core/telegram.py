import asyncio
import logging

from aiogram import Bot

from core.config import settings

logger = logging.getLogger(__name__)

SEND_MESSAGE_TIMEOUT_SECONDS = 10.0


async def send_message(chat_id: int, text: str) -> None:
    """The one place `api`/`worker`/`bot` reach out to Telegram from. Builds a
    short-lived Bot per call rather than sharing one across processes — sending a
    message is a single outbound HTTPS request, not a reason to add a cross-process
    channel (CLAUDE.md: don't add infrastructure without asking).

    The timeout guards every caller uniformly — including
    core/api/routes/business_days.py's close_day route, which awaits this before
    returning its HTTP response. Without it, a Telegram network stall would hang
    the request forever instead of just failing the notification. A TimeoutError
    raised by wait_for is an ordinary Exception subclass, so every existing
    caller's `except Exception` guard already handles it with no changes needed."""
    if not settings.bot_token:
        logger.warning("BOT_TOKEN is not set — cannot send a Telegram message to %s", chat_id)
        return
    bot = Bot(token=settings.bot_token)
    try:
        await asyncio.wait_for(
            bot.send_message(chat_id, text), timeout=SEND_MESSAGE_TIMEOUT_SECONDS
        )
    finally:
        await bot.session.close()
