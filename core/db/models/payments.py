import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base


class PaymentMethod(str, enum.Enum):
    cash = "cash"
    transfer = "transfer"


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"))
    business_day_id: Mapped[int] = mapped_column(ForeignKey("business_days.id"))
    amount: Mapped[int] = mapped_column()
    method: Mapped[PaymentMethod] = mapped_column(Enum(PaymentMethod, native_enum=False, length=20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
