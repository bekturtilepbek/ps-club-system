from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
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

    day = await business_days.get_open_business_day(db)
    return HallSnapshot(
        generated_at=now,
        business_day_open=day is not None,
        business_day_id=day.id if day is not None else None,
        consoles=views,
        tickets=tickets,
    )
