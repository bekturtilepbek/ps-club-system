"""The /admin pages the owner edits tariffs, bar, consoles and settings through."""

import os

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.db.models import AuditLog, Console, Product, Setting, Tariff, TariffKind, Zone
from core.db.session import engine as app_engine

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test"
)


@pytest_asyncio.fixture(autouse=True)
async def _dispose_app_engine():
    """SQLAdmin and the audit writer use the app-wide engine, whose pooled asyncpg
    connections are bound to one test's event loop - drop them after every test."""
    yield
    await app_engine.dispose()


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine(TEST_DATABASE_URL)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


async def _zone(db) -> Zone:
    zone = Zone(name="Зал", is_active=True)
    db.add(zone)
    await db.commit()
    return zone


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["tariff", "product", "console", "setting", "zone"])
async def test_every_list_and_create_page_renders(client, path):
    assert (await client.get(f"/admin/{path}/list")).status_code == 200
    assert (await client.get(f"/admin/{path}/create")).status_code == 200


@pytest.mark.asyncio
async def test_pages_are_in_russian(client):
    page = (await client.get("/admin/tariff/create")).text
    for text in ("Название", "Длительность, мин", "Ставка, сом в час", "Продаётся"):
        assert text in page


@pytest.mark.asyncio
async def test_setting_key_is_a_dropdown_of_the_known_keys(client):
    page = (await client.get("/admin/setting/create")).text
    assert "<select" in page
    for key in ("grace_minutes", "planned_close", "owner_chat_id"):
        assert f'value="{key}"' in page


@pytest.mark.asyncio
async def test_setting_value_is_validated_and_normalised(client, db):
    ok = await client.post(
        "/admin/setting/create",
        data={"key": "planned_close", "value": " 5:30 "},
        follow_redirects=False,
    )
    assert ok.status_code == 302
    stored = await db.get(Setting, "planned_close")
    assert stored.value == "05:30"

    bad = await client.post(
        "/admin/setting/create",
        data={"key": "grace_minutes", "value": "abc"},
        follow_redirects=False,
    )
    assert bad.status_code == 400
    assert "целое число минут" in bad.text
    assert await db.get(Setting, "grace_minutes") is None


@pytest.mark.asyncio
async def test_an_already_set_setting_cannot_be_created_twice(client, db):
    db.add(Setting(key="grace_minutes", value="2"))
    await db.commit()

    response = await client.post(
        "/admin/setting/create", data={"key": "grace_minutes", "value": "9"}, follow_redirects=False
    )

    assert response.status_code == 400
    assert "уже задан" in response.text


@pytest.mark.asyncio
async def test_editing_a_setting_changes_only_its_value(client, db):
    db.add(Setting(key="grace_minutes", value="2"))
    await db.commit()

    response = await client.post(
        "/admin/setting/edit/grace_minutes",
        data={"key": "grace_minutes", "value": "1"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    db.expire_all()
    assert (await db.get(Setting, "grace_minutes")).value == "1"
    audit = (
        await db.execute(select(AuditLog).where(AuditLog.action == "setting_update"))
    ).scalars()
    assert [a.details for a in audit] == [{"key": "grace_minutes", "value": "1"}]


@pytest.mark.asyncio
async def test_creating_a_package_tariff(client, db):
    zone = await _zone(db)

    response = await client.post(
        "/admin/tariff/create",
        data={
            "zone": zone.id,
            "kind": "package",
            "name": "2 часа",
            "duration_min": "120",
            "price": "300",
            "hourly_rate": "",
            "is_active": "y",
        },
        follow_redirects=False,
    )

    assert response.status_code == 302
    tariff = (await db.execute(select(Tariff).where(Tariff.name == "2 часа"))).scalar_one()
    assert (tariff.kind, tariff.duration_min, tariff.price, tariff.hourly_rate) == (
        TariffKind.package,
        120,
        300,
        None,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("fields", "message"),
    [
        ({"kind": "package", "duration_min": "", "price": "300"}, "длительность"),
        ({"kind": "package", "duration_min": "60", "price": ""}, "цену"),
        (
            {"kind": "package", "duration_min": "60", "price": "300", "hourly_rate": "180"},
            "очистите",
        ),
        ({"kind": "open", "hourly_rate": ""}, "ставку"),
        ({"kind": "open", "hourly_rate": "180", "price": "100"}, "очистите"),
    ],
)
async def test_tariff_with_inconsistent_fields_gets_a_readable_error(client, db, fields, message):
    zone = await _zone(db)
    form = {"zone": zone.id, "name": "Тест", "is_active": "y", **fields}

    response = await client.post("/admin/tariff/create", data=form, follow_redirects=False)

    assert response.status_code == 400
    assert message in response.text
    assert (await db.execute(select(Tariff))).scalars().all() == []


@pytest.mark.asyncio
async def test_creating_an_open_time_tariff_and_a_product_and_a_console(client, db):
    zone = await _zone(db)

    open_tariff = await client.post(
        "/admin/tariff/create",
        data={
            "zone": zone.id,
            "kind": "open",
            "name": "Открытое время",
            "hourly_rate": "180",
            "is_active": "y",
        },
        follow_redirects=False,
    )
    product = await client.post(
        "/admin/product/create",
        data={"name": "Кола", "category": "Напитки", "price": "80", "is_active": "y"},
        follow_redirects=False,
    )
    console = await client.post(
        "/admin/console/create",
        data={"zone": zone.id, "name": "PS5-1", "is_active": "y"},
        follow_redirects=False,
    )

    assert (open_tariff.status_code, product.status_code, console.status_code) == (302, 302, 302)
    assert (await db.execute(select(Product))).scalar_one().price == 80
    created = (await db.execute(select(Console))).scalar_one()
    assert (created.name, created.plug_driver) == ("PS5-1", "manual")


@pytest.mark.asyncio
async def test_new_records_are_active_by_default(client):
    for path in ("tariff", "product", "console", "zone"):
        page = (await client.get(f"/admin/{path}/create")).text
        checkbox = page[page.index('name="is_active"') - 80 : page.index('name="is_active"') + 80]
        assert "checked" in checkbox, path


@pytest.mark.asyncio
async def test_tariff_kind_is_shown_in_russian_and_preselected_on_edit(client, db):
    zone = await _zone(db)
    tariff = Tariff(
        zone_id=zone.id, kind=TariffKind.open, name="Открытое", hourly_rate=180, is_active=True
    )
    db.add(tariff)
    await db.commit()

    create_page = (await client.get("/admin/tariff/create")).text
    assert ">Пакет<" in create_page and ">Открытое время<" in create_page
    assert "package</option>" not in create_page

    edit_page = (await client.get(f"/admin/tariff/edit/{tariff.id}")).text
    assert 'selected value="open"' in edit_page or 'value="open" selected' in edit_page


@pytest.mark.asyncio
async def test_editing_a_tariff_price_is_audited_with_before_and_after(client, db):
    zone = await _zone(db)
    tariff = Tariff(
        zone_id=zone.id,
        kind=TariffKind.package,
        name="1 час",
        duration_min=60,
        price=150,
        is_active=True,
    )
    db.add(tariff)
    await db.commit()
    tariff_id = tariff.id

    response = await client.post(
        f"/admin/tariff/edit/{tariff_id}",
        data={
            "zone": zone.id,
            "kind": "package",
            "name": "1 час",
            "duration_min": "60",
            "price": "180",
            "hourly_rate": "",
            "is_active": "y",
        },
        follow_redirects=False,
    )

    assert response.status_code == 302
    db.expire_all()
    assert (await db.get(Tariff, tariff_id)).price == 180
    [entry] = (
        (await db.execute(select(AuditLog).where(AuditLog.action == "tariff_update")))
        .scalars()
        .all()
    )
    assert entry.details["before"]["price"] == 150
    assert entry.details["after"]["price"] == 180


@pytest.mark.asyncio
async def test_chrome_is_translated(client):
    page = (await client.get("/admin/tariff/list")).text
    assert "Добавить: Тариф" in page and "Выйти" in page
    assert "Logout" not in page and "New Тариф" not in page
    create = (await client.get("/admin/tariff/create")).text
    assert "Сохранить и продолжить" in create and "Отмена" in create
    # SQLAdmin compares these submitted values, so they must stay as it expects.
    assert 'value="Save and continue editing"' in create


@pytest.mark.asyncio
async def test_save_and_continue_still_redirects_to_the_edit_page(client, db):
    response = await client.post(
        "/admin/zone/create",
        data={"name": "VIP", "is_active": "y", "save": "Save and continue editing"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert "/admin/zone/edit/" in response.headers["location"]
