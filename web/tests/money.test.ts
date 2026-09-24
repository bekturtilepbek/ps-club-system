import { describe, expect, it } from "vitest";
import { estimateOpenTimeAmount } from "@/lib/money";

describe("estimateOpenTimeAmount", () => {
  it("is zero before the segment starts accruing", () => {
    expect(estimateOpenTimeAmount(0, 120)).toBe(0);
    expect(estimateOpenTimeAmount(-60_000, 120)).toBe(0);
  });

  it("charges a full hour at the hourly rate", () => {
    expect(estimateOpenTimeAmount(60 * 60_000, 120)).toBe(120);
  });

  it("bills per minute at hourly rate / 60 and rounds only the total", () => {
    // 10 min at 100/h = 16.67 -> 17
    expect(estimateOpenTimeAmount(10 * 60_000, 100)).toBe(17);
    // 1 min at 100/h = 1.67 -> 2; 2 min = 3.33 -> 3 (not 2 + 2)
    expect(estimateOpenTimeAmount(60_000, 100)).toBe(2);
    expect(estimateOpenTimeAmount(2 * 60_000, 100)).toBe(3);
  });

  it("rounds halves up like the backend", () => {
    // 3 min at 10/h = 0.5 -> 1
    expect(estimateOpenTimeAmount(3 * 60_000, 10)).toBe(1);
  });
});
