import { describe, expect, it } from "vitest";
import { rangeForPreset, toIsoDate, ALL_TIME_FROM } from "@/features/analytics/periods";

// 2026-09-30T20:00:00Z is 02:00 on 1 October in Bishkek: the club's "today" is already the 1st.
const NOW = Date.parse("2026-09-30T20:00:00Z");

describe("periods", () => {
  it("reads today's date on the club's clock, not the machine's", () => {
    expect(toIsoDate(NOW)).toBe("2026-10-01");
  });

  it("last 7 days ends today and covers seven calendar days", () => {
    expect(rangeForPreset("last7", NOW)).toEqual({ from: "2026-09-25", to: "2026-10-01" });
  });

  it("last 30 days covers thirty calendar days", () => {
    expect(rangeForPreset("last30", NOW)).toEqual({ from: "2026-09-02", to: "2026-10-01" });
  });

  it("this month runs from the 1st to today", () => {
    expect(rangeForPreset("thisMonth", NOW)).toEqual({ from: "2026-10-01", to: "2026-10-01" });
  });

  it("previous month is the whole previous calendar month, across a year boundary too", () => {
    expect(rangeForPreset("prevMonth", NOW)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(rangeForPreset("prevMonth", Date.parse("2027-01-10T08:00:00Z"))).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    });
  });

  it("all time starts long before the club existed; the server clamps it", () => {
    expect(rangeForPreset("all", NOW)).toEqual({ from: ALL_TIME_FROM, to: "2026-10-01" });
  });
});
