import os

import pytest

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test"
)


async def _setup(client):
    await client.post("/api/business-days/open", json={"opening_cash": 5000})
    # SQLAdmin isn't wired in yet (Task 16) — insert reference data straight through the ORM
    # via the same DB the `client` fixture points at is not available here, so this test
    # seeds through a second, direct DB connection instead.
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.models import Console, Tariff, TariffKind, Zone

    engine = create_async_engine(TEST_DATABASE_URL)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        zone = Zone(name="Зал", is_active=True)
        db.add(zone)
        await db.flush()
        console = Console(zone_id=zone.id, name="PS5-1")
        package = Tariff(
            zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150
        )
        db.add_all([console, package])
        await db.commit()
        await db.refresh(console)
        await db.refresh(package)
        console_id, package_id = console.id, package.id
    await engine.dispose()
    return console_id, package_id


@pytest.mark.asyncio
async def test_start_session_through_api(client):
    console_id, package_id = await _setup(client)

    response = await client.post(
        "/api/sessions", json={"console_id": console_id, "tariff_id": package_id}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "active"
    assert body["charge_total"] == 150
    assert body["balance"] == 150


@pytest.mark.asyncio
async def test_starting_a_session_without_an_open_business_day_is_409(client):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.models import Console, Tariff, TariffKind, Zone

    engine = create_async_engine(TEST_DATABASE_URL)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        zone = Zone(name="Зал", is_active=True)
        db.add(zone)
        await db.flush()
        console = Console(zone_id=zone.id, name="PS5-1")
        package = Tariff(
            zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150
        )
        db.add_all([console, package])
        await db.commit()
        await db.refresh(console)
        await db.refresh(package)
        console_id, package_id = console.id, package.id
    await engine.dispose()

    response = await client.post(
        "/api/sessions", json={"console_id": console_id, "tariff_id": package_id}
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_paying_a_non_positive_amount_is_422(client):
    console_id, package_id = await _setup(client)
    started = await client.post(
        "/api/sessions", json={"console_id": console_id, "tariff_id": package_id}
    )
    session_id = started.json()["id"]

    response = await client.post(
        f"/api/sessions/{session_id}/payments", json={"amount": 0, "method": "cash"}
    )
    assert response.status_code == 422


async def _add_game(name: str, *, is_active: bool = True) -> int:
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.models import Game

    engine = create_async_engine(TEST_DATABASE_URL)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        game = Game(name=name, is_active=is_active)
        db.add(game)
        await db.commit()
        game_id = game.id
    await engine.dispose()
    return game_id


@pytest.mark.asyncio
async def test_start_session_records_the_chosen_game(client):
    console_id, package_id = await _setup(client)
    game_id = await _add_game("FC26")

    response = await client.post(
        "/api/sessions",
        json={"console_id": console_id, "tariff_id": package_id, "game_id": game_id},
    )

    assert response.status_code == 200
    assert (response.json()["game_id"], response.json()["game"]) == (game_id, "FC26")


@pytest.mark.asyncio
async def test_the_game_is_optional(client):
    console_id, package_id = await _setup(client)

    response = await client.post(
        "/api/sessions", json={"console_id": console_id, "tariff_id": package_id}
    )

    assert response.status_code == 200
    assert (response.json()["game_id"], response.json()["game"]) == (None, None)


@pytest.mark.asyncio
@pytest.mark.parametrize("hidden", [False, True])
async def test_an_unknown_or_hidden_game_is_refused(client, hidden):
    console_id, package_id = await _setup(client)
    game_id = await _add_game("Старая игра", is_active=False) if hidden else 9999

    response = await client.post(
        "/api/sessions",
        json={"console_id": console_id, "tariff_id": package_id, "game_id": game_id},
    )

    assert response.status_code == 404
    started = await client.get("/api/hall")
    assert all(c["session"] is None for c in started.json()["consoles"])


@pytest.mark.asyncio
async def test_games_endpoint_lists_active_games_by_name(client):
    await _add_game("UFC5")
    await _add_game("FC26")
    await _add_game("Старая игра", is_active=False)
    await _add_game("Mortal Kombat 1")

    response = await client.get("/api/games")

    assert response.status_code == 200
    assert [g["name"] for g in response.json()] == ["FC26", "Mortal Kombat 1", "UFC5"]
    assert set(response.json()[0]) == {"id", "name"}


@pytest.mark.asyncio
async def test_games_endpoint_requires_login(anonymous_client):
    assert (await anonymous_client.get("/api/games")).status_code == 401
