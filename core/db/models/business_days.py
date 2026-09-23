from datetime import datetime

from sqlalchemy import DateTime
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base


class BusinessDay(Base):
    __tablename__ = "business_days"

    id: Mapped[int] = mapped_column(primary_key=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    opening_cash: Mapped[int] = mapped_column()
    expected_cash: Mapped[int | None] = mapped_column(default=None)
    counted_cash: Mapped[int | None] = mapped_column(default=None)
