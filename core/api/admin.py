from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Request
from sqladmin import Admin, ModelView

from core.config import settings
from core.db.models import AuditLog, Console, Product, Setting, Tariff, Zone
from core.db.session import async_session_factory, engine


async def _write_audit_log(action: str, entity: str, entity_id: Any, details: dict) -> None:
    async with async_session_factory() as session:
        session.add(
            AuditLog(
                action=action,
                entity=entity,
                entity_id=entity_id,
                details=details,
                created_at=datetime.now(ZoneInfo(settings.timezone)),
            )
        )
        await session.commit()


class ZoneAdmin(ModelView, model=Zone):
    column_list = [Zone.id, Zone.name, Zone.is_active]
    can_delete = False


class ConsoleAdmin(ModelView, model=Console):
    column_list = [
        Console.id, Console.zone_id, Console.name,
        Console.plug_driver, Console.plug_address, Console.is_active,
    ]
    can_delete = False


class TariffAdmin(ModelView, model=Tariff):
    column_list = [
        Tariff.id, Tariff.zone_id, Tariff.kind, Tariff.name,
        Tariff.duration_min, Tariff.price, Tariff.hourly_rate, Tariff.is_active,
    ]
    can_delete = False

    async def after_model_change(
        self, data: dict, model: Any, is_created: bool, request: Request
    ) -> None:
        await _write_audit_log(
            action="tariff_create" if is_created else "tariff_update",
            entity="tariff",
            entity_id=model.id,
            details={k: v for k, v in data.items() if k != "id"},
        )


class ProductAdmin(ModelView, model=Product):
    column_list = [Product.id, Product.name, Product.price, Product.is_active]
    can_delete = False


class SettingAdmin(ModelView, model=Setting):
    column_list = [Setting.key, Setting.value]
    can_delete = False

    async def after_model_change(
        self, data: dict, model: Any, is_created: bool, request: Request
    ) -> None:
        # audit_log.entity_id is a NOT NULL integer (every other writer passes a
        # session id); Setting's primary key is the `key` string, which has no
        # integer counterpart, so a real id can't be supplied here. Using a fixed
        # sentinel keeps the insert schema-valid without losing traceability — the
        # actual key is still recorded in `details` below. Confirmed by hand: passing
        # `model.key` as entity_id raises asyncpg.exceptions.DataError and silently
        # drops the audit row while the underlying setting update still commits.
        # Workaround, not a root-cause fix — the root cause is entity_id's type not
        # accommodating non-integer entity keys; widening it needs its own migration.
        await _write_audit_log(
            action="setting_create" if is_created else "setting_update",
            entity="setting",
            entity_id=0,
            details={"key": model.key, "value": model.value},
        )


def register_admin(app: FastAPI) -> Admin:
    admin = Admin(app, engine)
    admin.add_view(ZoneAdmin)
    admin.add_view(ConsoleAdmin)
    admin.add_view(TariffAdmin)
    admin.add_view(ProductAdmin)
    admin.add_view(SettingAdmin)
    return admin
