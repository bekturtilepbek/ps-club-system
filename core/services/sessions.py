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
from core.domain import money
from core.domain import segments as domain_segments
from core.services import business_days
from core.services import settings as settings_service
from core.services.errors import ConflictError, NotFoundError, ValidationError


def _new_segment_from_tariff(tariff: Tariff, *, starts_at: datetime) -> SessionSegment:
    if tariff.kind == TariffKind.package:
        ends_at = domain_segments.package_segment_end(starts_at, tariff.duration_min)
        return SessionSegment(
            tariff_id=tariff.id,
            kind=SegmentKind.package,
            starts_at=starts_at,
            ends_at=ends_at,
            price_snapshot=tariff.price,
            amount=tariff.price,
        )
    return SessionSegment(
        tariff_id=tariff.id,
        kind=SegmentKind.open,
        starts_at=starts_at,
        ends_at=None,
        price_snapshot=tariff.hourly_rate,
        amount=None,
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
            tariff_id=None,
            kind=SegmentKind.open,
            starts_at=grace_until,
            ends_at=None,
            price_snapshot=0,
            amount=None,
        )

    session.segments.append(segment)
    db.add(session)
    await db.flush()  # assigns session.id, needed below before it's committed

    if kind == SessionKind.free:
        db.add(
            AuditLog(
                action="free_session_start",
                entity="session",
                entity_id=session.id,
                details={"console_id": console_id, "reason": reason},
                created_at=now,
            )
        )

    await db.commit()
    await db.refresh(session)
    return session


async def _last_segment(db: AsyncSession, session_id: int) -> SessionSegment | None:
    result = await db.execute(
        select(SessionSegment)
        .where(SessionSegment.session_id == session_id)
        .order_by(SessionSegment.starts_at.desc())
        .limit(1)
    )
    return result.scalars().first()


def _snapshot(segment: SessionSegment) -> domain_segments.ActiveSegment:
    return domain_segments.ActiveSegment(
        kind=segment.kind.value, starts_at=segment.starts_at, ends_at=segment.ends_at
    )


async def extend_session(
    db: AsyncSession, *, session_id: int, tariff_id: int, now: datetime
) -> SessionModel:
    session = await db.get(SessionModel, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")
    if session.status != SessionStatus.active:
        raise ConflictError(f"session {session_id} is not active")
    if session.kind != SessionKind.paid:
        raise ValidationError("only paid sessions can be extended with a tariff")

    tariff = await db.get(Tariff, tariff_id)
    if tariff is None or not tariff.is_active:
        raise NotFoundError(f"tariff {tariff_id} not found or inactive")

    last = await _last_segment(db, session_id)
    start = domain_segments.next_segment_start(now, _snapshot(last) if last else None)

    if last is not None and last.kind == SegmentKind.open and last.ends_at is None:
        last.ends_at = start
        last.amount = money.open_time_amount(
            (start - last.starts_at).total_seconds(), last.price_snapshot
        )

    session.segments.append(_new_segment_from_tariff(tariff, starts_at=start))
    await db.commit()
    await db.refresh(session)
    return session


async def stop_session(db: AsyncSession, *, session_id: int, now: datetime) -> SessionModel:
    session = await db.get(SessionModel, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")
    if session.status != SessionStatus.active:
        raise ConflictError(f"session {session_id} is not active")

    last = await _last_segment(db, session_id)
    if last is not None:
        if last.kind == SegmentKind.open and last.ends_at is None:
            last.ends_at = now
            last.amount = (
                money.open_time_amount((now - last.starts_at).total_seconds(), last.price_snapshot)
                if session.kind == SessionKind.paid
                else 0
            )
        elif last.kind == SegmentKind.package and last.ends_at is not None and now < last.ends_at:
            db.add(
                AuditLog(
                    action="early_stop",
                    entity="session",
                    entity_id=session_id,
                    details={
                        "segment_id": last.id,
                        "planned_end": last.ends_at.isoformat(),
                        "stopped_at": now.isoformat(),
                    },
                    created_at=now,
                )
            )

    session.status = SessionStatus.finished
    session.ended_at = now
    await db.commit()
    await db.refresh(session)
    return session


async def cancel_session(db: AsyncSession, *, session_id: int, now: datetime) -> SessionModel:
    session = await db.get(SessionModel, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")
    if session.status != SessionStatus.active:
        raise ConflictError(f"session {session_id} is not active")
    if not domain_segments.is_within_grace(now, session.grace_until):
        raise ConflictError("cancel window has expired")

    for segment in session.segments:
        segment.amount = 0
        if segment.kind == SegmentKind.open and segment.ends_at is None:
            segment.ends_at = now

    session.status = SessionStatus.cancelled
    session.ended_at = now
    db.add(
        AuditLog(
            action="cancel",
            entity="session",
            entity_id=session_id,
            details={"cancelled_at": now.isoformat()},
            created_at=now,
        )
    )
    await db.commit()
    await db.refresh(session)
    return session
