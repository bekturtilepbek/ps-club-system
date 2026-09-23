import pytest

from core.plugs.base import PlugState
from core.plugs.fake import FakePlugDriver
from core.plugs.manual import ManualPlugDriver


@pytest.mark.asyncio
async def test_manual_driver_never_reports_a_known_state():
    driver = ManualPlugDriver()
    await driver.turn_on("console-1")
    await driver.turn_off("console-1")
    assert await driver.get_state("console-1") == PlugState.unknown
    assert await driver.get_power("console-1") is None


@pytest.mark.asyncio
async def test_fake_driver_tracks_state_and_power():
    driver = FakePlugDriver()
    assert await driver.get_state("console-1") == PlugState.unknown

    await driver.turn_on("console-1")
    assert await driver.get_state("console-1") == PlugState.on
    assert await driver.get_power("console-1") == 45.0

    await driver.turn_off("console-1")
    assert await driver.get_state("console-1") == PlugState.off
    assert await driver.get_power("console-1") == 0.0
