import pytest
from sqlalchemy import select

from core.db.models import Zone


@pytest.mark.asyncio
async def test_db_session_fixture_persists_a_row(db_session):
    db_session.add(Zone(name="Зал", is_active=True))
    await db_session.commit()

    zone = (await db_session.execute(select(Zone))).scalar_one()
    assert zone.name == "Зал"
