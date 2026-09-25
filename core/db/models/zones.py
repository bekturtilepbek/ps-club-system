from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.db.base import Base


class Zone(Base):
    __tablename__ = "zones"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(default=True)


class Console(Base):
    __tablename__ = "consoles"

    id: Mapped[int] = mapped_column(primary_key=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id"))
    name: Mapped[str] = mapped_column(String(100))
    plug_driver: Mapped[str] = mapped_column(String(50), default="manual")
    plug_address: Mapped[str | None] = mapped_column(String(200), default=None)
    is_active: Mapped[bool] = mapped_column(default=True)

    zone: Mapped["Zone"] = relationship("Zone")
