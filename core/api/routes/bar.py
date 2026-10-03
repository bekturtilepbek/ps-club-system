from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.clock import now as _now
from core.api.deps import require_auth
from core.api.limits import EntityId
from core.api.schemas.bar import ProductResponse
from core.db.session import get_session
from core.services import bar as bar_service

products_router = APIRouter(prefix="/products", tags=["bar"], dependencies=[Depends(require_auth)])
orders_router = APIRouter(prefix="/orders", tags=["bar"], dependencies=[Depends(require_auth)])


@products_router.get("", response_model=list[ProductResponse])
async def list_products(db: AsyncSession = Depends(get_session)):  # noqa: B008
    products = await bar_service.list_active_products(db)
    return [ProductResponse.model_validate(p) for p in products]


@orders_router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_order(order_id: EntityId, db: AsyncSession = Depends(get_session)):  # noqa: B008
    await bar_service.remove_order(db, order_id=order_id, now=_now())
