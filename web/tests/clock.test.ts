import { describe, expect, it } from "vitest";
import { serverNow, updateClockOffset } from "@/lib/clock";

describe("clock offset", () => {
  it("adjusts serverNow by the difference between server and local time", () => {
    const clientNow = Date.now();
    const serverIso = new Date(clientNow + 5000).toISOString();
    updateClockOffset(serverIso);
    expect(serverNow() - clientNow).toBeGreaterThanOrEqual(4900);
    expect(serverNow() - clientNow).toBeLessThanOrEqual(5100);
  });
});
