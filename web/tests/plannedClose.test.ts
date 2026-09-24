import { describe, expect, it } from "vitest";
import { estimateExtendStartMs, nextPlannedCloseMs, packageEndsAfterPlannedClose } from "@/features/hall/plannedClose";

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

describe("estimateExtendStartMs", () => {
  it("returns now when there is no prior segment", () => {
    const now = bishkek("2026-09-25T02:00:00+06:00");
    expect(estimateExtendStartMs(now, undefined)).toBe(now);
  });

  it("uses the running package's end, not now, when the package hasn't finished", () => {
    const now = bishkek("2026-09-25T02:00:00+06:00");
    const packageEnd = bishkek("2026-09-25T04:00:00+06:00");
    expect(
      estimateExtendStartMs(now, { kind: "package", starts_at: "2026-09-25T01:00:00+06:00", ends_at: "2026-09-25T04:00:00+06:00" }),
    ).toBe(packageEnd);
  });

  it("uses now when the package has already ended", () => {
    const now = bishkek("2026-09-25T05:00:00+06:00");
    expect(
      estimateExtendStartMs(now, { kind: "package", starts_at: "2026-09-25T01:00:00+06:00", ends_at: "2026-09-25T04:00:00+06:00" }),
    ).toBe(now);
  });

  it("uses the open segment's own start when it hasn't started accruing yet", () => {
    const now = bishkek("2026-09-25T02:00:00+06:00");
    const queuedStart = bishkek("2026-09-25T03:00:00+06:00");
    expect(
      estimateExtendStartMs(now, { kind: "open", starts_at: "2026-09-25T03:00:00+06:00", ends_at: null }),
    ).toBe(queuedStart);
  });

  it("uses now when an open segment is already accruing", () => {
    const now = bishkek("2026-09-25T02:00:00+06:00");
    expect(
      estimateExtendStartMs(now, { kind: "open", starts_at: "2026-09-25T01:00:00+06:00", ends_at: null }),
    ).toBe(now);
  });
});
