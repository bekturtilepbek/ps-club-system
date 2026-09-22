import asyncio
import logging

from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command
from aiogram.types import Message

from core.config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("bot")

dp = Dispatcher()
dp.message.filter(F.chat.id == settings.owner_chat_id)


@dp.message(Command("start"))
async def start_handler(message: Message) -> None:
    await message.answer("PS Club bot is running.")


async def run_polling() -> None:
    if settings.owner_chat_id is None:
        logger.warning(
            "BOT_TOKEN is set but OWNER_CHAT_ID is not — the bot will poll but "
            "silently ignore every message. Set OWNER_CHAT_ID in .env to fix this."
        )
    bot = Bot(token=settings.bot_token)  # type: ignore[arg-type]
    logger.info("bot starting polling")
    await dp.start_polling(bot)


async def wait_idle() -> None:
    logger.warning(
        "BOT_TOKEN is not set — bot is idle. "
        "Set BOT_TOKEN (and OWNER_CHAT_ID) in .env and restart to enable polling."
    )
    await asyncio.Event().wait()


def main() -> None:
    if settings.bot_token:
        asyncio.run(run_polling())
    else:
        asyncio.run(wait_idle())


if __name__ == "__main__":
    main()
