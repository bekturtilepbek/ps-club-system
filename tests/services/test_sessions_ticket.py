from datetime import UTC, datetime

import pytest

from core.db.models import SessionKind, SessionStatus
from core.services.business_days import open_business_day
from core.services.errors import ConflictError
from core.services.sessions import cancel_session, open_ticket

T = datetime(2026, 9, 24, 12, 0, 0, tzinfo=UTC)


@pytest.mark.asyncio
async def test_open_ticket_creates_a_console_less_paid_session(db_session):
    await open_business_day(db_session, opening_cash=5000, now=T)

    ticket = await open_ticket(db_session, now=T)

    assert ticket.console_id is None
    assert ticket.kind == SessionKind.paid
    assert ticket.status == SessionStatus.active
    assert ticket.grace_until is None
    assert ticket.segments == []


@pytest.mark.asyncio
async def test_open_ticket_without_an_open_business_day_is_a_conflict(db_session):
    with pytest.raises(ConflictError):
        await open_ticket(db_session, now=T)


@pytest.mark.asyncio
async def test_two_tickets_can_be_open_at_once(db_session):
    # Guards against the partial unique index on (console_id, active) rejecting a
    # second NULL console_id — Postgres treats NULLs as distinct for uniqueness,
    # but this pins that assumption down as an explicit, checked behaviour.
    await open_business_day(db_session, opening_cash=5000, now=T)

    first = await open_ticket(db_session, now=T)
    second = await open_ticket(db_session, now=T)

    assert first.id != second.id


@pytest.mark.asyncio
async def test_a_ticket_cannot_be_cancelled(db_session):
    # No grace_until means no grace window: cancel_session must reject it exactly
    # like it already rejects cancelling a console session past its own deadline
    # (tests/services/test_sessions_lifecycle.py covers that existing case).
    await open_business_day(db_session, opening_cash=5000, now=T)
    ticket = await open_ticket(db_session, now=T)

    with pytest.raises(ConflictError):
        await cancel_session(db_session, session_id=ticket.id, now=T)
