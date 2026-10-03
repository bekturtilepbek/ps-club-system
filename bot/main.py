import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.filters import Command
from aiogram.types import BotCommand, Message

from bot.filters import OwnerOnlyFilter
from bot.handlers import build_hall_status_text
from core.api.clock import now as _now
from core.config import settings
from core.db.session import async_session_factory
from core.services.settings import get_owner_chat_id

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("bot")

dp = Dispatcher()
dp.message.filter(OwnerOnlyFilter())


@dp.message(Command("start"))
async def start_handler(message: Message) -> None:
    await message.answer("PS-клуб: бот работает. Команда /hall покажет, что сейчас в зале.")


@dp.message(Command("hall"))
async def hall_handler(message: Message) -> None:
    async with async_session_factory() as db:
        text = await build_hall_status_text(db, _now())
    await message.answer(text)


async def run_polling() -> None:
    async with async_session_factory() as db:
        owner_chat_id = await get_owner_chat_id(db)
    if owner_chat_id is None:
        logger.warning(
            "owner_chat_id is not set — the bot will poll but silently ignore every "
            "message. Set it via /admin (Setting: owner_chat_id) to fix this."
        )
    bot = Bot(token=settings.bot_token)  # type: ignore[arg-type]
    await bot.set_my_commands(
        [
            BotCommand(command="start", description="Проверить, что бот работает"),
            BotCommand(command="hall", description="Что сейчас в зале"),
        ]
    )
    logger.info("bot starting polling")
    await dp.start_polling(bot)


async def wait_idle() -> None:
    logger.warning(
        "BOT_TOKEN is not set — bot is idle. Set BOT_TOKEN in .env and restart to enable polling."
    )
    await asyncio.Event().wait()


def main() -> None:
    if settings.bot_token:
        asyncio.run(run_polling())
    else:
        asyncio.run(wait_idle())


if __name__ == "__main__":
    main()
