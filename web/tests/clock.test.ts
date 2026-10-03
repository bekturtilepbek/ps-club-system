import { afterEach, describe, expect, it, vi } from "vitest";
import { serverNow, updateClockOffset } from "@/lib/clock";

describe("clock offset", () => {
  it("adjusts serverNow by the difference between server and local time", () => {
    const clientNow = Date.now();
    const serverIso = new Date(clientNow + 5000).toISOString();
    updateClockOffset(serverIso);
    expect(serverNow() - clientNow).toBeGreaterThanOrEqual(4900);
    expect(serverNow() - clientNow).toBeLessThanOrEqual(5100);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is not thrown off when the PC's wall clock is stepped after the sync", () => {
    // Windows time sync / NTP corrects a wrong clock while the till is open: the offset taken
    // from the last server message must keep meaning "server time", not "PC clock + difference".
    const serverMs = Date.now() + 10_000;
    updateClockOffset(new Date(serverMs).toISOString());
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 180_000);

    expect(Math.abs(serverNow() - serverMs)).toBeLessThan(500);
  });

  it("keeps advancing with real elapsed time between server messages", async () => {
    const serverMs = Date.now();
    updateClockOffset(new Date(serverMs).toISOString());

    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(serverNow() - serverMs).toBeGreaterThanOrEqual(100);
    expect(serverNow() - serverMs).toBeLessThan(1000);
  });
});
