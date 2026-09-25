from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Request
from sqladmin import Admin, ModelView
from sqladmin.authentication import AuthenticationBackend
from starlette.responses import RedirectResponse

from core.auth.password import verify_password
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

    async def on_model_change(
        self, data: dict, model: Any, is_created: bool, request: Request
    ) -> None:
        # Runs before the change is committed — model still holds the old values
        # here. Stashed on request.state (per-request, safe under concurrent admin
        # edits) so after_model_change can build a before/after pair below; a plain
        # instance attribute on TariffAdmin would leak between concurrent requests,
        # since SQLAdmin reuses one TariffAdmin instance for every request.
        if not is_created:
            request.state.tariff_before = {
                "name": model.name,
                "kind": model.kind.value if model.kind else None,
                "duration_min": model.duration_min,
                "price": model.price,
                "hourly_rate": model.hourly_rate,
                "is_active": model.is_active,
            }

    async def after_model_change(
        self, data: dict, model: Any, is_created: bool, request: Request
    ) -> None:
        details: dict[str, Any] = {"after": {k: v for k, v in data.items() if k != "id"}}
        before = getattr(request.state, "tariff_before", None)
        if before is not None:
            details["before"] = before
        await _write_audit_log(
            action="tariff_create" if is_created else "tariff_update",
            entity="tariff",
            entity_id=model.id,
            details=details,
        )


class ProductAdmin(ModelView, model=Product):
    column_list = [Product.id, Product.name, Product.price, Product.is_active]
    can_delete = False


class SettingAdmin(ModelView, model=Setting):
    column_list = [Setting.key, Setting.value]
    # Setting.key is the primary key but is not auto-generated (it's a
    # hand-picked string like "owner_chat_id"), so SQLAdmin's default
    # form_include_pk=False (which assumes a PK is auto-generated) leaves the
    # create form with no way to set it at all, regardless of form_columns.
    form_include_pk = True
    form_columns = [Setting.key, Setting.value]
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


class AdminAuth(AuthenticationBackend):
    async def login(self, request: Request) -> bool:
        form = await request.form()
        password = form.get("password")
        if not password or not verify_password(str(password), settings.admin_password_hash):
            return False
        request.session["authenticated"] = True
        return True

    async def logout(self, request: Request) -> bool:
        request.session.clear()
        return True

    async def authenticate(self, request: Request) -> bool | RedirectResponse:
        return bool(request.session.get("authenticated"))


def register_admin(app: FastAPI) -> Admin:
    admin = Admin(
        app, engine, authentication_backend=AdminAuth(secret_key=settings.session_secret)
    )
    admin.add_view(ZoneAdmin)
    admin.add_view(ConsoleAdmin)
    admin.add_view(TariffAdmin)
    admin.add_view(ProductAdmin)
    admin.add_view(SettingAdmin)
    return admin
