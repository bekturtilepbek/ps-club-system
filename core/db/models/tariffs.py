import enum

from sqlalchemy import CheckConstraint, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.db.base import Base
from core.db.models.zones import Zone


class TariffKind(str, enum.Enum):
    package = "package"
    open = "open"


class Tariff(Base):
    __tablename__ = "tariffs"
    __table_args__ = (
        CheckConstraint(
            "(kind = 'package' AND duration_min IS NOT NULL AND price IS NOT NULL "
            "AND hourly_rate IS NULL) OR "
            "(kind = 'open' AND duration_min IS NULL AND price IS NULL "
            "AND hourly_rate IS NOT NULL)",
            name="ck_tariffs_kind_fields",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id"))
    kind: Mapped[TariffKind] = mapped_column(Enum(TariffKind, native_enum=False, length=20))
    name: Mapped[str] = mapped_column(String(100))
    duration_min: Mapped[int | None] = mapped_column(default=None)
    price: Mapped[int | None] = mapped_column(default=None)
    hourly_rate: Mapped[int | None] = mapped_column(default=None)
    is_active: Mapped[bool] = mapped_column(default=True)

    zone: Mapped[Zone] = relationship("Zone")
