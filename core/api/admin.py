from fastapi import FastAPI
from sqladmin import Admin, ModelView

from core.db.models import Console, Product, Setting, Tariff, Zone
from core.db.session import engine


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


class ProductAdmin(ModelView, model=Product):
    column_list = [Product.id, Product.name, Product.price, Product.is_active]
    can_delete = False


class SettingAdmin(ModelView, model=Setting):
    column_list = [Setting.key, Setting.value]


def register_admin(app: FastAPI) -> Admin:
    admin = Admin(app, engine)
    admin.add_view(ZoneAdmin)
    admin.add_view(ConsoleAdmin)
    admin.add_view(TariffAdmin)
    admin.add_view(ProductAdmin)
    admin.add_view(SettingAdmin)
    return admin
