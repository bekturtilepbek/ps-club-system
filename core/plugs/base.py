import enum
from abc import ABC, abstractmethod


class PlugState(str, enum.Enum):
    on = "on"
    off = "off"
    unknown = "unknown"


class PlugDriver(ABC):
    """SPEC 5.3: turn_on/turn_off/get_state/get_power. Implementations: manual
    (Phase 1), Tapo/Shelly (Phase 2), fake (tests). No vendor types leak past
    this interface (CLAUDE.md rule 12)."""

    @abstractmethod
    async def turn_on(self, address: str) -> None: ...

    @abstractmethod
    async def turn_off(self, address: str) -> None: ...

    @abstractmethod
    async def get_state(self, address: str) -> PlugState: ...

    @abstractmethod
    async def get_power(self, address: str) -> float | None: ...
