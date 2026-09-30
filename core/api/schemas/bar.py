from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ProductResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    price: int
    is_active: bool
    category: str | None = None


class OrderRequest(BaseModel):
    product_id: int
    qty: int = Field(gt=0)


class OrderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    product_id: int
    qty: int
    unit_price: int
    created_at: datetime
