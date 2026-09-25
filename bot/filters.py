from aiogram.filters import BaseFilter
from aiogram.types import Message

from core.db.session import async_session_factory
from core.services.settings import get_owner_chat_id


class OwnerOnlyFilter(BaseFilter):
    """SPEC.md §3.7: "Отвечает только на chat_id владельца" — otherwise anyone who
    finds the bot could read hall status, and in Phase 2 could control plugs."""

    async def __call__(self, message: Message) -> bool:
        async with async_session_factory() as db:
            owner_chat_id = await get_owner_chat_id(db)
        return owner_chat_id is not None and message.chat.id == owner_chat_id
