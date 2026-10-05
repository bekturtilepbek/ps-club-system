import { describe, expect, it } from "vitest";
import { changeTone, formatChange, formatPeriodLabel, heatOpacity, slotLabel } from "@/features/analytics/analyticsModel";

describe("analytics model", () => {
  it("labels a heatmap slot with the weekday and the hour range", () => {
    expect(slotLabel(0, 18)).toBe("пн, 18:00–19:00");
    expect(slotLabel(6, 23)).toBe("вс, 23:00–00:00");
  });

  it("keeps an empty cell faint but visible and a full cell opaque", () => {
    expect(heatOpacity(0)).toBeCloseTo(0.06);
    expect(heatOpacity(100)).toBe(1);
    expect(heatOpacity(250)).toBe(1);
    expect(heatOpacity(50)).toBeGreaterThan(heatOpacity(10));
  });

  it("formats a change with an explicit sign and a real minus", () => {
    expect(formatChange(12)).toBe("+12%");
    expect(formatChange(-5.4)).toBe("−5%");
    expect(formatChange(0)).toBe("0%");
    expect(formatChange(null)).toBe("—");
  });

  it("classifies a change for the arrow", () => {
    expect(changeTone(3)).toBe("up");
    expect(changeTone(-3)).toBe("down");
    expect(changeTone(0)).toBe("flat");
    expect(changeTone(null)).toBe("flat");
  });

  it("labels chart buckets by their granularity", () => {
    expect(formatPeriodLabel("2026-09-14", "day")).toBe("14.09");
    expect(formatPeriodLabel("2026-09-14", "week")).toBe("нед. 14.09");
    expect(formatPeriodLabel("2026-09-01", "month")).toBe("сентябрь 2026");
  });
});
