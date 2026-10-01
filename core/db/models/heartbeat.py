from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base


class ServiceHeartbeat(Base):
    """Last time a background process reported it is alive; read by /api/health."""

    __tablename__ = "service_heartbeats"

    name: Mapped[str] = mapped_column(String(50), primary_key=True)
    beat_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
