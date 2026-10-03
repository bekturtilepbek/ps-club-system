from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.deps import require_auth
from core.api.schemas.tariffs import TariffResponse
from core.db.models import Tariff
from core.db.session import get_session

router = APIRouter(prefix="/tariffs", tags=["tariffs"], dependencies=[Depends(require_auth)])


@router.get("", response_model=list[TariffResponse])
async def list_tariffs(db: AsyncSession = Depends(get_session)) -> list[TariffResponse]:  # noqa: B008
    result = await db.execute(select(Tariff).where(Tariff.is_active.is_(True)).order_by(Tariff.id))
    return [TariffResponse.model_validate(t) for t in result.scalars().all()]
