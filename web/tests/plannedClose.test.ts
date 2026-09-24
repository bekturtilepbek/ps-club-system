import { describe, expect, it } from "vitest";
import { nextPlannedCloseMs, packageEndsAfterPlannedClose } from "@/features/hall/plannedClose";

// ISO strings carry an explicit +06:00 offset, so .getTime() gives the same absolute
// instant regardless of the machine/CI timezone running this test.
const bishkek = (iso: string) => new Date(iso).getTime();

describe("nextPlannedCloseMs", () => {
  it("returns today's close time when it is still ahead", () => {
    const now = bishkek("2026-09-24T22:00:00+06:00");
    expect(nextPlannedCloseMs(now, "05:00")).toBe(bishkek("2026-09-25T05:00:00+06:00"));
  });

  it("rolls over to tomorrow when today's close time has already passed", () => {
    const now = bishkek("2026-09-25T06:00:00+06:00");
    expect(nextPlannedCloseMs(now, "05:00")).toBe(bishkek("2026-09-26T05:00:00+06:00"));
  });

  it("rolls over exactly at the boundary instant", () => {
    const now = bishkek("2026-09-25T05:00:00+06:00");
    expect(nextPlannedCloseMs(now, "05:00")).toBe(bishkek("2026-09-26T05:00:00+06:00"));
  });
});

describe("packageEndsAfterPlannedClose", () => {
  it("flags a 5-hour package started at 02:00 with a 05:00 close", () => {
    const start = bishkek("2026-09-25T02:00:00+06:00");
    expect(packageEndsAfterPlannedClose(start, 5 * 60, "05:00")).toBe(true);
  });

  it("does not flag a 1-hour package started at 02:00 with a 05:00 close", () => {
    const start = bishkek("2026-09-25T02:00:00+06:00");
    expect(packageEndsAfterPlannedClose(start, 60, "05:00")).toBe(false);
  });
});
