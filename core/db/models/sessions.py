import enum
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.db.base import Base

if TYPE_CHECKING:
    from core.db.models.bar import Order
    from core.db.models.games import Game


class SessionKind(str, enum.Enum):
    paid = "paid"
    free = "free"
    service = "service"


class SessionStatus(str, enum.Enum):
    active = "active"
    finished = "finished"
    cancelled = "cancelled"


class SegmentKind(str, enum.Enum):
    package = "package"
    open = "open"


class Session(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        Index(
            "ux_sessions_one_active_per_console",
            "console_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    console_id: Mapped[int | None] = mapped_column(ForeignKey("consoles.id"), default=None)
    business_day_id: Mapped[int] = mapped_column(ForeignKey("business_days.id"))
    kind: Mapped[SessionKind] = mapped_column(Enum(SessionKind, native_enum=False, length=20))
    reason: Mapped[str | None] = mapped_column(String(200), default=None)
    status: Mapped[SessionStatus] = mapped_column(
        Enum(SessionStatus, native_enum=False, length=20), default=SessionStatus.active
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    grace_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    comment: Mapped[str | None] = mapped_column(Text, default=None)
    # What the guests said they would play (optional, for analytics; not verified).
    game_id: Mapped[int | None] = mapped_column(ForeignKey("games.id"), default=None)
    game: Mapped["Game | None"] = relationship("Game", lazy="selectin")

    segments: Mapped[list["SessionSegment"]] = relationship(
        "SessionSegment",
        # id breaks ties between a zero-length clamped segment and the one after it
        order_by="[SessionSegment.starts_at, SessionSegment.id]",
        lazy="selectin",
    )
    orders: Mapped[list["Order"]] = relationship(
        "Order", order_by="Order.created_at", lazy="selectin"
    )


class SessionSegment(Base):
    __tablename__ = "session_segments"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"))
    tariff_id: Mapped[int | None] = mapped_column(ForeignKey("tariffs.id"), default=None)
    kind: Mapped[SegmentKind] = mapped_column(Enum(SegmentKind, native_enum=False, length=20))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    price_snapshot: Mapped[int] = mapped_column()
    amount: Mapped[int | None] = mapped_column(default=None)
    # When the operator sold this segment. An open segment queued behind a package
    # *starts* in the future, so starts_at cannot tell when an extension happened.
    # NULL on rows created before this column existed.
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
