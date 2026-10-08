"""Fill a fresh production database with the club's starting data, through the admin.

    uv run python scripts/seed_prod.py https://<your-site>

Asks for the admin password (typed hidden; never stored). Safe to run again: whatever
already exists is skipped. It goes through the same /admin forms a person would use, so the
validation and the audit log apply. It does NOT open a business day and does not touch
planned hours or the Telegram settings - do those in /admin.
"""

import getpass
import os
import re
import sys

import httpx

CONSOLES = [f"PS5-{number}" for number in range(1, 7)]
# (name, kind, duration_min, price, hourly_rate)
TARIFFS = [
    ("1 час", "package", 60, 180, None),
    ("3 часа", "package", 180, 420, None),
    ("5 часов", "package", 300, 600, None),
    ("Открытое время", "open", None, None, 180),
]
GAMES = ["FC27", "FC26", "Mortal Kombat 1", "UFC5", "UFC6", "GTA5"]


def _sizes(brand: str, prices: dict[str, int]) -> list[tuple[str, int]]:
    return [(f"{brand} {size} л", price) for size, price in prices.items()]


_COLA_PRICES = {"0,5": 65, "1": 100, "1,5": 140, "2": 180}
# (category, [(name, price), ...]) - the bar shows one tab per category, in this order.
MENU = [
    (
        "Напитки",
        [
            *_sizes("Coca-Cola", _COLA_PRICES),
            *_sizes("Fanta", _COLA_PRICES),
            *_sizes("Sprite", _COLA_PRICES),
            *_sizes("Piko", {"0,5": 95, "1": 160}),
            ("Pepsi 1 л", 100),
            ("Asu 1 л", 70),
            ("Gorilla", 90),
            ("Nitro", 80),
            *_sizes("Fuse Tea", {"0,5": 65, "1": 100}),
            ("Lipton Tea 1 л", 100),
            ("Maxi Чай 1 л", 120),
            ("Garden 1 л", 120),
            ("Султан Чай Чёрный 1 л", 60),
            ("Султан Чай Зелёный 1 л", 60),
            ("Легенда 1 л", 50),
            ("Piala Ice Tea 1,25 л", 100),
        ],
    ),
    (
        "Закуски",
        [
            ("Kav&Kev (кетчуп, майонез)", 110),
            ("Тойбосс (кетчуп, майонез)", 110),
            ("Kav&Kev (другие вкусы)", 120),
            ("Тойбосс (другие вкусы)", 120),
            ("Snickers малый", 80),
            ("Snickers большой", 100),
            ("Twix малый", 80),
            ("Twix большой", 100),
            ("Bounty малый", 80),
            ("Bounty большой", 110),
            ("Mars малый", 80),
            ("M&M's малый", 90),
            ("M&M's большой", 150),
            ("Skittles", 80),
            ("Milky Way малый", 45),
        ],
    ),
]
SETTINGS = {"grace_minutes": "1"}  # time to pick a game, minutes


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    base = sys.argv[1].rstrip("/")
    password = os.environ.get("ADMIN_PASSWORD") or getpass.getpass("Admin password: ")

    with httpx.Client(base_url=base, follow_redirects=False, timeout=30) as client:
        login = client.post("/admin/login", data={"username": "owner", "password": password})
        if login.status_code != 302:
            print(
                f"Login failed (HTTP {login.status_code}): wrong password, "
                "or locked out for 15 minutes."
            )
            return 1

        def create(path: str, label: str, data: dict) -> None:
            response = client.post(f"/admin/{path}/create", data=data)
            if response.status_code == 302:
                print(f"  added   {label}")
            elif response.status_code == 400 and "уже" in response.text:
                print(f"  exists  {label}")
            else:
                print(f"  FAILED  {label}: HTTP {response.status_code} {error_text(response.text)}")

        zone_id = ensure_zone(client)
        print(f"zone: {zone_id}")

        print("consoles:")
        have = {c["name"] for c in client.get("/api/hall").json()["consoles"]}
        for name in CONSOLES:
            if name in have:
                print(f"  exists  {name}")
            else:
                create("console", name, {"zone": zone_id, "name": name, "is_active": "y"})

        print("tariffs:")
        have = {t["name"] for t in client.get("/api/tariffs").json()}
        for name, kind, duration, price, rate in TARIFFS:
            if name in have:
                print(f"  exists  {name}")
                continue
            create(
                "tariff",
                name,
                {
                    "zone": zone_id,
                    "kind": kind,
                    "name": name,
                    "duration_min": "" if duration is None else duration,
                    "price": "" if price is None else price,
                    "hourly_rate": "" if rate is None else rate,
                    "is_active": "y",
                },
            )

        print("games:")
        have = {g["name"] for g in client.get("/api/games").json()}
        for name in GAMES:
            if name in have:
                print(f"  exists  {name}")
            else:
                create("game", name, {"name": name, "is_active": "y"})

        print("bar products:")
        have = {p["name"].lower() for p in client.get("/api/products").json()}
        for category, items in MENU:
            for name, price in items:
                if name.lower() in have:
                    print(f"  exists  {name}")
                    continue
                create(
                    "product",
                    f"{category}: {name}",
                    {"name": name, "category": category, "price": price, "is_active": "y"},
                )

        print("settings:")
        for key, value in SETTINGS.items():
            create("setting", f"{key} = {value}", {"key": key, "value": value})

    print("Done. Next in /admin: planned hours, owner_chat_id; then open the day.")
    return 0


def ensure_zone(client: httpx.Client) -> str:
    """The id of the club's zone, created if there is none yet (read off the tariff form)."""

    def zone_options() -> list[tuple[str, str]]:
        page = client.get("/admin/tariff/create").text
        return re.findall(r'<option[^>]*value="(\d+)"[^>]*>\s*([^<]+?)\s*</option>', page)

    options = zone_options()
    if not options:
        response = client.post("/admin/zone/create", data={"name": "Зал", "is_active": "y"})
        if response.status_code != 302:
            raise SystemExit(f"Could not create the zone: HTTP {response.status_code}")
        options = zone_options()
    return options[0][0]


def error_text(html: str) -> str:
    match = re.search(r'role="alert">([^<]+)<', html)
    return match.group(1).strip() if match else ""


if __name__ == "__main__":
    raise SystemExit(main())
