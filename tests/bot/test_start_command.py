"""/start through the real dispatcher with a Bot whose network session is faked."""

from datetime import datetime

import pytest
from aiogram import Bot
from aiogram.client.session.base import BaseSession
from aiogram.methods import SendMessage
from aiogram.types import Chat, Message, Update, User

from bot.main import dp
from core.db.models import Setting

OWNER = 111


class _FakeSession(BaseSession):
    def __init__(self) -> None:
        super().__init__()
        self.sent: list[str] = []

    async def close(self) -> None:
        pass

    async def stream_content(self, *args, **kwargs):
        yield b""

    async def make_request(self, bot, method, timeout=None):
        assert isinstance(method, SendMessage)
        self.sent.append(method.text)
        chat = Chat(id=method.chat_id, type="private")
        return Message(message_id=1, date=datetime.now(), chat=chat, text=method.text)


async def _say(bot: Bot, chat_id: int, text: str) -> None:
    message = Message(
        message_id=1,
        date=datetime.now(),
        chat=Chat(id=chat_id, type="private"),
        from_user=User(id=chat_id, is_bot=False, first_name="x"),
        text=text,
        entities=[{"type": "bot_command", "offset": 0, "length": len(text)}],
    )
    await dp.feed_update(bot, Update(update_id=1, message=message))


@pytest.mark.asyncio
async def test_start_answers_the_owner_in_russian(db_session):
    db_session.add(Setting(key="owner_chat_id", value=str(OWNER)))
    await db_session.commit()
    session = _FakeSession()

    await _say(Bot(token="123456:TEST", session=session), OWNER, "/start")

    assert session.sent == ["PS-клуб: бот работает. Команда /hall покажет, что сейчас в зале."]


@pytest.mark.asyncio
async def test_start_is_silent_for_everyone_else(db_session):
    db_session.add(Setting(key="owner_chat_id", value=str(OWNER)))
    await db_session.commit()
    session = _FakeSession()

    await _say(Bot(token="123456:TEST", session=session), 222, "/start")

    assert session.sent == []
