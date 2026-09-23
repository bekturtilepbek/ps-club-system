import logging

from core.plugs.base import PlugDriver, PlugState

logger = logging.getLogger("plugs.manual")


class ManualPlugDriver(PlugDriver):
    """No smart plugs yet (Phase 1, SPEC 3.8): instead of commanding a plug,
    this prompts the operator to turn the TV on/off by hand. State is always
    unknown because there is no real hardware to query."""

    async def turn_on(self, address: str) -> None:
        logger.info("manual driver: turn ON console %s by hand", address)

    async def turn_off(self, address: str) -> None:
        logger.info("manual driver: turn OFF console %s by hand", address)

    async def get_state(self, address: str) -> PlugState:
        return PlugState.unknown

    async def get_power(self, address: str) -> float | None:
        return None
