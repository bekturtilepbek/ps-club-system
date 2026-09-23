from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import (
    AuditLog,
    Console,
    SegmentKind,
    SessionKind,
    SessionSegment,
    SessionStatus,
    Tariff,
    TariffKind,
)
from core.db.models import Session as SessionModel
from core.domain import segments as domain_segments
from core.services import business_days
from core.services import settings as settings_service
from core.services.errors import ConflictError, NotFoundError, ValidationError


def _new_segment_from_tariff(tariff: Tariff, *, starts_at: datetime) -> SessionSegment:
    if tariff.kind == TariffKind.package:
        ends_at = domain_segments.package_segment_end(starts_at, tariff.duration_min)
        return SessionSegment(
            tariff_id=tariff.id, kind=SegmentKind.package, starts_at=starts_at, ends_at=ends_at,
            price_snapshot=tariff.price, amount=tariff.price,
        )
    return SessionSegment(
        tariff_id=tariff.id, kind=SegmentKind.open, starts_at=starts_at, ends_at=None,
        price_snapshot=tariff.hourly_rate, amount=None,
    )


async def start_session(
    db: AsyncSession,
    *,
    console_id: int,
    kind: SessionKind,
    tariff_id: int | None,
    reason: str | None,
    comment: str | None,
    now: datetime,
) -> SessionModel:
    console = await db.get(Console, console_id)
    if console is None or not console.is_active:
        raise NotFoundError(f"console {console_id} not found or inactive")

    occupied = await db.execute(
        select(SessionModel).where(
            SessionModel.console_id == console_id,
            SessionModel.status == SessionStatus.active,
        )
    )
    if occupied.scalars().first() is not None:
        raise ConflictError(f"console {console_id} already has an active session")

    if kind == SessionKind.free and not reason:
        raise ValidationError("free session requires a reason")

    day = await business_days.get_open_business_day(db)
    if day is None:
        raise ConflictError("no open business day")

    grace_minutes = await settings_service.get_grace_minutes(db)
    grace_until = domain_segments.grace_until(now, grace_minutes)

    session = SessionModel(
        console_id=console_id,
        business_day_id=day.id,
        kind=kind,
        reason=reason,
        status=SessionStatus.active,
        started_at=now,
        grace_until=grace_until,
        comment=comment,
    )

    if kind == SessionKind.paid:
        tariff = await db.get(Tariff, tariff_id) if tariff_id else None
        if tariff is None or not tariff.is_active:
            raise NotFoundError(f"tariff {tariff_id} not found or inactive")
        segment = _new_segment_from_tariff(tariff, starts_at=grace_until)
    else:
        segment = SessionSegment(
            tariff_id=None, kind=SegmentKind.open, starts_at=grace_until, ends_at=None,
            price_snapshot=0, amount=None,
        )

    session.segments.append(segment)
    db.add(session)
    await db.flush()  # assigns session.id, needed below before it's committed

    if kind == SessionKind.free:
        db.add(AuditLog(
            action="free_session_start", entity="session", entity_id=session.id,
            details={"console_id": console_id, "reason": reason}, created_at=now,
        ))

    await db.commit()
    await db.refresh(session)
    return session
