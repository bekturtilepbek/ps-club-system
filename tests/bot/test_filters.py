from types import SimpleNamespace

import pytest

from bot.filters import OwnerOnlyFilter
from core.db.models import Setting


def _fake_message(chat_id: int) -> SimpleNamespace:
    return SimpleNamespace(chat=SimpleNamespace(id=chat_id))


@pytest.mark.asyncio
async def test_rejects_every_chat_when_owner_chat_id_is_unset(db_session):
    result = await OwnerOnlyFilter()(_fake_message(555))
    assert result is False


@pytest.mark.asyncio
async def test_accepts_only_the_configured_owner_chat_id(db_session):
    db_session.add(Setting(key="owner_chat_id", value="777"))
    await db_session.commit()

    assert await OwnerOnlyFilter()(_fake_message(777)) is True
    assert await OwnerOnlyFilter()(_fake_message(555)) is False
