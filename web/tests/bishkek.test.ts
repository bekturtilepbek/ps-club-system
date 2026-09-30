import { describe, expect, it } from "vitest";
import { bishkekHour, formatClock, formatDayLabel } from "@/lib/bishkek";

// 2026-09-29T18:40:00Z is 00:40 on Wednesday 30.09 in Bishkek (UTC+6).
const LATE_NIGHT = Date.parse("2026-09-29T18:40:00Z");

describe("club wall clock", () => {
  it("reads the hour on the club's clock, not the machine's", () => {
    expect(bishkekHour(LATE_NIGHT)).toBe(0);
    expect(bishkekHour(Date.parse("2026-09-30T04:00:00Z"))).toBe(10);
  });

  it("formats HH:MM with leading zeros", () => {
    expect(formatClock(LATE_NIGHT)).toBe("00:40");
  });

  it("labels a day with a short weekday and dd.mm", () => {
    expect(formatDayLabel(LATE_NIGHT)).toBe("ср, 30.09");
  });
});
