from pydantic import BaseModel, ConfigDict

from core.db.models import TariffKind


class TariffResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    zone_id: int
    kind: TariffKind
    name: str
    duration_min: int | None
    price: int | None
    hourly_rate: int | None
    is_active: bool
