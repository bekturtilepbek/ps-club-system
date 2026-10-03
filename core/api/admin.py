import enum
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Request
from markupsafe import Markup, escape
from sqladmin import Admin, ModelView
from sqladmin.authentication import AuthenticationBackend
from sqlalchemy import func, select
from starlette.responses import RedirectResponse
from wtforms import Form, SelectField, StringField

from core.api.limits import MAX_MONEY
from core.auth.password import verify_password
from core.auth.throttle import login_throttle
from core.config import settings
from core.db.models import AuditLog, Console, Game, Product, Setting, Tariff, TariffKind, Zone
from core.db.session import async_session_factory, engine
from core.services.settings import SETTING_SPECS, SETTING_SPECS_BY_KEY, validate_setting_value

KIND_LABELS = {TariffKind.package: "Пакет", TariffKind.open: "Открытое время"}
TEMPLATES_DIR = Path(__file__).parent / "admin_templates"  # Russian copies of SQLAdmin's pages


def _enum_value(value: Any) -> str:
    return value.value if isinstance(value, enum.Enum) else str(value)


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


def _yes_no(model: Any, attribute: str) -> str:
    return "да" if getattr(model, attribute) else "нет"


def _normalized_name(value: Any) -> str:
    """Names are compared and stored without stray spaces ("  Кола  " is "Кола")."""
    return " ".join((value or "").split())


async def _refuse_duplicate_name(model: Any, name: str, current_id: int | None, what: str) -> None:
    """Two consoles called "PS5-1" (or two "Кола") are indistinguishable on the hall screen, in the
    bar and in every report, and nothing can be deleted afterwards - so refuse them up front."""
    same_name = select(model.id).where(func.lower(model.name) == name.lower())
    if current_id is not None:
        same_name = same_name.where(model.id != current_id)
    async with async_session_factory() as session:
        clash = await session.scalar(same_name)
    if clash is not None:
        raise ValueError(f"{what} «{name}» уже есть в списке.")


def _check_money(value: int | None, what: str) -> None:
    if value is not None and value > MAX_MONEY:
        limit = f"{MAX_MONEY:,}".replace(",", " ")
        raise ValueError(f"{what} слишком большая: не больше {limit} сом.")


class DefaultsOnNewForm(Form):
    """SQLAdmin builds the "new record" form from an empty (not None) formdata, so wtforms
    ignores every field default and a checkbox like "Продаётся" shows up unticked - a new
    tariff would then be saved switched off. Treat empty formdata as no formdata."""

    def process(self, formdata=None, obj=None, data=None, extra_filters=None, **kwargs):
        if formdata is not None and not formdata:
            formdata = None
        super().process(formdata, obj, data=data, extra_filters=extra_filters, **kwargs)


class OwnerView(ModelView):
    """Shared look of every admin section: no export, no read-only details page (rows open
    straight in the edit form), nothing is ever deleted."""

    form_base_class = DefaultsOnNewForm
    can_export = False
    can_view_details = False
    can_delete = False
    page_size = 50
    page_size_options = [25, 50, 100]


class ZoneAdmin(OwnerView, model=Zone):
    name = "Зона"
    name_plural = "Зоны"
    icon = "fa-solid fa-layer-group"
    column_list = [Zone.name, Zone.is_active]
    column_labels = {Zone.name: "Название", Zone.is_active: "Работает"}
    column_formatters = {Zone.is_active: lambda m, a: _yes_no(m, "is_active")}
    form_columns = [Zone.name, Zone.is_active]
    form_args = {
        "name": {
            "description": "Например «Зал». Сейчас зона одна; VIP-комнаты позже станут новой зоной."
        },
        "is_active": {
            "default": True,
            "description": "Выключенная зона не используется. Удалять зоны нельзя — "
            "только выключать.",
        },
    }


class ConsoleAdmin(OwnerView, model=Console):
    name = "Консоль"
    name_plural = "Консоли"
    icon = "fa-solid fa-gamepad"
    column_list = [Console.name, Console.zone, Console.is_active]
    column_labels = {
        Console.name: "Название",
        Console.zone: "Зона",
        Console.is_active: "В работе",
    }
    column_formatters = {Console.is_active: lambda m, a: _yes_no(m, "is_active")}
    # plug_driver / plug_address exist for the smart plugs of phase 2 and are not used yet.
    form_columns = [Console.zone, Console.name, Console.is_active]
    form_args = {
        "name": {"description": "Так консоль называется на экране зала, например «PS5-1»."},
        "is_active": {
            "default": True,
            "description": "Снимите галочку, если консоль на ремонте: на экране зала её нельзя "
            "будет запустить. Удалять консоли нельзя — только выключать.",
        },
    }

    async def on_model_change(
        self, data: dict, model: Any, is_created: bool, request: Request
    ) -> None:
        name = _normalized_name(data.get("name"))
        if not name:
            raise ValueError("Укажите название консоли.")
        await _refuse_duplicate_name(Console, name, model.id, "Консоль")
        data["name"] = name


class TariffAdmin(OwnerView, model=Tariff):
    name = "Тариф"
    name_plural = "Тарифы"
    icon = "fa-solid fa-tags"
    column_list = [
        Tariff.name,
        Tariff.kind,
        Tariff.duration_min,
        Tariff.price,
        Tariff.hourly_rate,
        Tariff.is_active,
        Tariff.zone,
    ]
    column_labels = {
        Tariff.name: "Название",
        Tariff.kind: "Вид",
        Tariff.duration_min: "Длительность, мин",
        Tariff.price: "Цена пакета, сом",
        Tariff.hourly_rate: "Ставка, сом в час",
        Tariff.is_active: "Продаётся",
        Tariff.zone: "Зона",
    }
    column_formatters = {
        Tariff.kind: lambda m, a: KIND_LABELS.get(m.kind, m.kind),
        Tariff.is_active: lambda m, a: _yes_no(m, "is_active"),
    }
    form_columns = [
        Tariff.zone,
        Tariff.kind,
        Tariff.name,
        Tariff.duration_min,
        Tariff.price,
        Tariff.hourly_rate,
        Tariff.is_active,
    ]
    # The stock Enum field shows the raw names ("package"); a plain select shows Russian ones.
    form_overrides = {"kind": SelectField}
    form_args = {
        "kind": {
            "choices": [(kind.value, label) for kind, label in KIND_LABELS.items()],
            "coerce": _enum_value,
            "description": "Пакет — фиксированное время и цена. Открытое время — без конца, "
            "считается поминутно по ставке.",
        },
        "duration_min": {"description": "Только для пакета, в минутах: 60, 180, 300."},
        "price": {"description": "Только для пакета: цена целиком, в сомах."},
        "hourly_rate": {"description": "Только для открытого времени: сколько стоит час, в сомах."},
        "is_active": {
            "default": True,
            "description": "Снимите галочку, чтобы тариф пропал с экрана старта. Старые "
            "сессии сохраняют свою цену. Удалять тарифы нельзя — только выключать.",
        },
    }

    async def on_model_change(
        self, data: dict, model: Any, is_created: bool, request: Request
    ) -> None:
        kind = TariffKind(_enum_value(data.get("kind")))
        duration, price, rate = data.get("duration_min"), data.get("price"), data.get("hourly_rate")
        name = _normalized_name(data.get("name"))
        if not name:
            raise ValueError("Укажите название тарифа.")
        await _refuse_duplicate_name(Tariff, name, model.id, "Тариф")
        data["name"] = name
        if duration is not None and duration > 24 * 60:
            raise ValueError("Пакет не может быть длиннее суток (1440 минут).")
        _check_money(price, "Цена пакета")
        _check_money(rate, "Ставка")
        if kind == TariffKind.package:
            if not duration or duration <= 0:
                raise ValueError("Для пакета укажите длительность в минутах, например 60.")
            if price is None or price < 0:
                raise ValueError("Для пакета укажите цену в сомах.")
            if rate is not None:
                raise ValueError("Ставка в час нужна только для открытого времени — очистите её.")
        else:
            if rate is None or rate < 0:
                raise ValueError(
                    "Для открытого времени укажите ставку: сколько стоит час, в сомах."
                )
            if duration is not None or price is not None:
                raise ValueError(
                    "Длительность и цена пакета нужны только для пакета — очистите их."
                )
        data["kind"] = kind.value

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


class ProductAdmin(OwnerView, model=Product):
    name = "Товар"
    name_plural = "Товары бара"
    icon = "fa-solid fa-bottle-water"
    column_list = [Product.name, Product.category, Product.price, Product.is_active]
    column_labels = {
        Product.name: "Название",
        Product.category: "Вкладка в баре",
        Product.price: "Цена, сом",
        Product.is_active: "В продаже",
    }
    column_formatters = {Product.is_active: lambda m, a: _yes_no(m, "is_active")}
    form_columns = [Product.name, Product.category, Product.price, Product.is_active]
    form_args = {
        "category": {
            "description": "На экране бара товары разложены по вкладкам: впишите, например, "
            "«Напитки» или «Еда». Для всех товаров одной вкладки пишите одинаково."
        },
        "price": {"description": "Сомы, целое число. Старые заказы сохраняют свою цену."},
        "is_active": {
            "default": True,
            "description": "Снимите галочку, чтобы убрать товар из бара. Удалять товары нельзя — "
            "только убирать из продажи.",
        },
    }

    async def on_model_change(
        self, data: dict, model: Any, is_created: bool, request: Request
    ) -> None:
        name = _normalized_name(data.get("name"))
        if not name:
            raise ValueError("Укажите название товара.")
        price = data.get("price")
        if price is None or price < 0:
            raise ValueError("Цена не может быть отрицательной: укажите сумму в сомах.")
        _check_money(price, "Цена")
        await _refuse_duplicate_name(Product, name, model.id, "Товар")
        data["name"] = name
        data["category"] = _normalized_name(data.get("category")) or None


class GameAdmin(OwnerView, model=Game):
    name = "Игра"
    name_plural = "Игры"
    icon = "fa-solid fa-trophy"
    column_list = [Game.name, Game.is_active]
    column_labels = {Game.name: "Название", Game.is_active: "В списке"}
    column_formatters = {Game.is_active: lambda m, a: _yes_no(m, "is_active")}
    column_default_sort = [(Game.name, False)]
    form_columns = [Game.name, Game.is_active]
    form_args = {
        "name": {
            "description": "Так игра будет называться в списке при старте сессии и в статистике. "
            "Пишите одинаково, например «FC26» (а не «fc 26»)."
        },
        "is_active": {
            "default": True,
            "description": "Снимите галочку, чтобы убрать игру из списка при старте. В старых "
            "сессиях она останется. Удалять игры нельзя — только убирать из списка.",
        },
    }

    async def on_model_change(
        self, data: dict, model: Any, is_created: bool, request: Request
    ) -> None:
        name = _normalized_name(data.get("name"))
        if not name:
            raise ValueError("Укажите название игры.")
        await _refuse_duplicate_name(Game, name, model.id, "Игра")
        data["name"] = name


def _setting_name(model: Setting, attribute: str) -> Markup:
    spec = SETTING_SPECS_BY_KEY.get(model.key)
    if spec is None:
        return Markup("<b>{}</b> <small>(неизвестный параметр)</small>").format(model.key)
    # The list table is nowrap; let the hint wrap or the value column is pushed off-screen.
    return Markup(
        "<div style='white-space:normal;min-width:240px;max-width:480px'>"
        "<b>{}</b><br><small class='text-muted'>{}</small></div>"
    ).format(escape(spec.label), escape(spec.hint))


class SettingAdmin(OwnerView, model=Setting):
    name = "Параметр"
    name_plural = "Параметры"
    icon = "fa-solid fa-sliders"
    column_list = [Setting.key, Setting.value]
    column_labels = {Setting.key: "Параметр", Setting.value: "Значение"}
    column_formatters = {Setting.key: _setting_name}
    # Setting.key is the primary key but is not auto-generated (the operator picks it from
    # the list of known keys), so SQLAdmin's default form_include_pk=False (which assumes a
    # PK is auto-generated) would leave the create form with no way to set it at all.
    form_include_pk = True
    form_columns = [Setting.key, Setting.value]
    form_overrides = {"key": SelectField, "value": StringField}
    form_args = {
        "key": {
            "label": "Параметр",
            "choices": [(spec.key, spec.label) for spec in SETTING_SPECS],
            "description": "Параметр можно задать один раз; потом меняется только его значение.",
        },
        "value": {
            "label": "Значение",
            "description": "Минуты — целое число (например 3). Время — ЧЧ:ММ (например 05:00). "
            "chat_id — число. Подсказка к каждому параметру есть в списке.",
        },
    }

    async def on_model_change(
        self, data: dict, model: Any, is_created: bool, request: Request
    ) -> None:
        key = data.get("key")
        if is_created:
            async with async_session_factory() as session:
                if await session.get(Setting, key) is not None:
                    raise ValueError(
                        "Этот параметр уже задан. Откройте его в списке и измените значение."
                    )
        elif key != model.key:
            raise ValueError("Название параметра менять нельзя — только значение.")
        data["value"] = validate_setting_value(key, data.get("value") or "")

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
        client = request.client.host if request.client else "unknown"
        if login_throttle.retry_after(client):
            return False
        form = await request.form()
        password = form.get("password")
        if not password or not verify_password(str(password), settings.admin_password_hash):
            login_throttle.record_failure(client)
            return False
        login_throttle.reset(client)
        request.session["authenticated"] = True
        return True

    async def logout(self, request: Request) -> bool:
        request.session.clear()
        return True

    async def authenticate(self, request: Request) -> bool | RedirectResponse:
        return bool(request.session.get("authenticated"))


def register_admin(app: FastAPI) -> Admin:
    admin = Admin(
        app,
        engine,
        authentication_backend=AdminAuth(secret_key=settings.session_secret),
        title="PS-клуб · настройки",
        templates_dir=str(TEMPLATES_DIR),
    )
    admin.add_view(TariffAdmin)
    admin.add_view(GameAdmin)
    admin.add_view(ProductAdmin)
    admin.add_view(ConsoleAdmin)
    admin.add_view(SettingAdmin)
    admin.add_view(ZoneAdmin)
    return admin
