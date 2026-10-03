from datetime import datetime

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import (
    AuditLog,
    Console,
    Game,
    Order,
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


def _new_segment_from_tariff(
    tariff: Tariff, *, starts_at: datetime, created_at: datetime
) -> SessionSegment:
    if tariff.kind == TariffKind.package:
        ends_at = domain_segments.package_segment_end(starts_at, tariff.duration_min)
        return SessionSegment(
            tariff_id=tariff.id,
            kind=SegmentKind.package,
            starts_at=starts_at,
            ends_at=ends_at,
            price_snapshot=tariff.price,
            amount=tariff.price,
            created_at=created_at,
        )
    return SessionSegment(
        tariff_id=tariff.id,
        kind=SegmentKind.open,
        starts_at=starts_at,
        ends_at=None,
        price_snapshot=tariff.hourly_rate,
        amount=None,
        created_at=created_at,
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
    game_id: int | None = None,
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

    if game_id is not None:
        game = await db.get(Game, game_id)
        if game is None or not game.is_active:
            raise NotFoundError(f"game {game_id} not found or inactive")

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
        game_id=game_id,
    )

    if kind == SessionKind.paid:
        tariff = await db.get(Tariff, tariff_id) if tariff_id else None
        if tariff is None or not tariff.is_active:
            raise NotFoundError(f"tariff {tariff_id} not found or inactive")
        segment = _new_segment_from_tariff(tariff, starts_at=grace_until, created_at=now)
    else:
        segment = SessionSegment(
            tariff_id=None,
            kind=SegmentKind.open,
            starts_at=grace_until,
            ends_at=None,
            price_snapshot=0,
            amount=None,
            created_at=now,
        )

    session.segments.append(segment)
    db.add(session)
    try:
        await db.flush()  # assigns session.id, needed below before it's committed
    except IntegrityError as exc:
        await db.rollback()
        if "ux_sessions_one_active_per_console" not in str(exc.orig):
            raise
        raise ConflictError(f"console {console_id} already has an active session") from None

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

    await db.execute(text("NOTIFY hall_changed"))
    await db.commit()
    await db.refresh(session)
    return session


async def _last_segment(db: AsyncSession, session_id: int) -> SessionSegment | None:
    result = await db.execute(
        select(SessionSegment)
        .where(SessionSegment.session_id == session_id)
        # id breaks ties: a queued open segment clamped to zero length shares its
        # starts_at with the segment chained after it, which is the real last one.
        .order_by(SessionSegment.starts_at.desc(), SessionSegment.id.desc())
        .limit(1)
    )
    return result.scalars().first()


async def _lock_session(db: AsyncSession, session_id: int) -> SessionModel | None:
    """The session row, locked until this transaction ends.

    extend/stop/cancel read the session's segments and then write new ones. Without the lock
    two requests for the same session (two tills, a tablet, a double tap) both read the same
    state: parallel extensions got the same start time and billed the same hour several times,
    and parallel stops/cancels all "succeeded" and wrote duplicate audit rows. With it the
    second request waits, then sees the first one's result (and, for stop/cancel, a session
    that is no longer active).
    """
    return await db.get(SessionModel, session_id, with_for_update=True)


def _snapshot(segment: SessionSegment) -> domain_segments.ActiveSegment:
    return domain_segments.ActiveSegment(
        kind=segment.kind.value, starts_at=segment.starts_at, ends_at=segment.ends_at
    )


async def extend_session(
    db: AsyncSession, *, session_id: int, tariff_id: int, now: datetime
) -> SessionModel:
    session = await _lock_session(db, session_id)
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

    session.segments.append(_new_segment_from_tariff(tariff, starts_at=start, created_at=now))
    await db.execute(text("NOTIFY hall_changed"))
    await db.commit()
    await db.refresh(session)
    return session


async def stop_session(db: AsyncSession, *, session_id: int, now: datetime) -> SessionModel:
    session = await _lock_session(db, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")
    if session.status != SessionStatus.active:
        raise ConflictError(f"session {session_id} is not active")

    # A package still paid past "now" is an early stop, even when an open segment is
    # queued behind it (so it isn't the last row). The package stays fully priced.
    running_package = next(
        (
            s
            for s in session.segments
            if s.kind == SegmentKind.package and s.ends_at is not None and now < s.ends_at
        ),
        None,
    )
    if running_package is not None:
        db.add(
            AuditLog(
                action="early_stop",
                entity="session",
                entity_id=session_id,
                details={
                    "segment_id": running_package.id,
                    "planned_end": running_package.ends_at.isoformat(),
                    "stopped_at": now.isoformat(),
                },
                created_at=now,
            )
        )

    for segment in session.segments:
        if segment.kind != SegmentKind.open or segment.ends_at is not None:
            continue
        if now >= segment.starts_at:
            segment.ends_at = now
            segment.amount = (
                money.open_time_amount(
                    (now - segment.starts_at).total_seconds(), segment.price_snapshot
                )
                if session.kind == SessionKind.paid
                else 0
            )
        else:
            # Queued behind a running package and never started accruing: close it
            # at its own start (zero length) instead of writing ends_at < starts_at.
            segment.ends_at = segment.starts_at
            segment.amount = 0

    session.status = SessionStatus.finished
    session.ended_at = now
    await db.execute(text("NOTIFY hall_changed"))
    await db.commit()
    await db.refresh(session)
    return session


async def cancel_session(db: AsyncSession, *, session_id: int, now: datetime) -> SessionModel:
    session = await _lock_session(db, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")
    if session.status != SessionStatus.active:
        raise ConflictError(f"session {session_id} is not active")
    if not domain_segments.is_within_grace(now, session.grace_until):
        raise ConflictError("cancel window has expired")
    has_orders = await db.scalar(select(Order.id).where(Order.session_id == session_id).limit(1))
    if has_orders is not None:
        # Owner decision (docs/OWNER_QUESTIONS.md, question 6): once a guest has taken bar
        # items the session is a normal one - stop it and settle, or remove the items first.
        raise ConflictError("session has bar items; stop it instead of cancelling")

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
    await db.execute(text("NOTIFY hall_changed"))
    await db.commit()
    await db.refresh(session)
    return session


async def open_ticket(db: AsyncSession, *, now: datetime) -> SessionModel:
    """A bar sale with no console attached (SPEC.md §3.5's "продажа без игры") —
    the same Session/segment/payment machinery a console session uses, just with
    console_id and grace_until left NULL and no segments: there's no game-choice
    grace period on a bar sale, so it can never be cancelled (cancel_session's
    is_within_grace check is False for a NULL grace_until) — a mis-added item is
    corrected with bar.remove_order instead."""
    day = await business_days.get_open_business_day(db)
    if day is None:
        raise ConflictError("no open business day")

    session = SessionModel(
        console_id=None,
        business_day_id=day.id,
        kind=SessionKind.paid,
        reason=None,
        status=SessionStatus.active,
        started_at=now,
        grace_until=None,
        comment=None,
    )
    db.add(session)
    await db.execute(text("NOTIFY hall_changed"))
    await db.commit()
    await db.refresh(session)
    return session
