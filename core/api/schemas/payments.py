from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from core.db.models import PaymentMethod


class PaymentRequest(BaseModel):
    amount: int = Field(gt=0)
    method: PaymentMethod


class PaymentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    amount: int
    method: PaymentMethod
    created_at: datetime
