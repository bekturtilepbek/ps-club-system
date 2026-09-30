from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import Console, SessionStatus
from core.db.models import Session as SessionModel
from core.services import business_days
from core.services import payments as payments_service


@dataclass(frozen=True)
class ConsoleHallView:
    id: int
    zone_id: int
    name: str
    is_active: bool
    session: SessionModel | None
    charge_total: int
    paid_total: int
    balance: int
    free_since: datetime | None = None


@dataclass(frozen=True)
class TicketHallView:
    session: SessionModel
    charge_total: int
    paid_total: int
    balance: int


@dataclass(frozen=True)
class HallSnapshot:
    generated_at: datetime
    business_day_open: bool
    business_day_id: int | None
    consoles: list[ConsoleHallView]
    tickets: list[TicketHallView]


async def build_hall_snapshot(db: AsyncSession, now: datetime) -> HallSnapshot:
    day = await business_days.get_open_business_day(db)

    last_ended: dict[int, datetime] = {}
    if day is not None:
        ended_result = await db.execute(
            select(SessionModel.console_id, func.max(SessionModel.ended_at))
            .where(SessionModel.console_id.is_not(None), SessionModel.ended_at.is_not(None))
            .group_by(SessionModel.console_id)
        )
        last_ended = {console_id: ended_at for console_id, ended_at in ended_result.all()}

    consoles_result = await db.execute(select(Console).order_by(Console.id))
    consoles = consoles_result.scalars().all()

    sessions_result = await db.execute(
        select(SessionModel).where(SessionModel.status == SessionStatus.active)
    )
    active_sessions = sessions_result.scalars().all()
    active_by_console = {s.console_id: s for s in active_sessions if s.console_id is not None}
    ticket_sessions = [s for s in active_sessions if s.console_id is None]

    views: list[ConsoleHallView] = []
    for console in consoles:
        session = active_by_console.get(console.id)
        if session is not None:
            charge = await payments_service.session_charge_total(db, session.id, now)
            paid = await payments_service.session_paid_total(db, session.id)
        else:
            charge = paid = 0
        free_since = None
        if session is None and day is not None:
            # Idle time runs from the last session's end, but never from before the day
            # opened: the hours the club was closed are not "простой".
            last = last_ended.get(console.id)
            free_since = max(last, day.opened_at) if last is not None else day.opened_at
        views.append(
            ConsoleHallView(
                id=console.id,
                zone_id=console.zone_id,
                name=console.name,
                is_active=console.is_active,
                session=session,
                charge_total=charge,
                paid_total=paid,
                balance=charge - paid,
                free_since=free_since,
            )
        )

    tickets: list[TicketHallView] = []
    for session in ticket_sessions:
        charge = await payments_service.session_charge_total(db, session.id, now)
        paid = await payments_service.session_paid_total(db, session.id)
        tickets.append(
            TicketHallView(
                session=session, charge_total=charge, paid_total=paid, balance=charge - paid
            )
        )

    return HallSnapshot(
        generated_at=now,
        business_day_open=day is not None,
        business_day_id=day.id if day is not None else None,
        consoles=views,
        tickets=tickets,
    )
