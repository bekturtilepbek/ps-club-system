from core.plugs.base import PlugDriver, PlugState


class FakePlugDriver(PlugDriver):
    """In-memory driver for tests (SPEC 5.3) — no real hardware or network."""

    def __init__(self) -> None:
        self._state: dict[str, PlugState] = {}

    async def turn_on(self, address: str) -> None:
        self._state[address] = PlugState.on

    async def turn_off(self, address: str) -> None:
        self._state[address] = PlugState.off

    async def get_state(self, address: str) -> PlugState:
        return self._state.get(address, PlugState.unknown)

    async def get_power(self, address: str) -> float | None:
        return 45.0 if self._state.get(address) == PlugState.on else 0.0
