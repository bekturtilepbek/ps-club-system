import { describe, expect, it } from "vitest";
import { formatDuration, formatSom } from "@/lib/format";

describe("formatDuration", () => {
  it("formats minutes and seconds", () => {
    expect(formatDuration(65_000)).toBe("1:05");
  });

  it("clamps negative durations to zero", () => {
    expect(formatDuration(-5000)).toBe("0:00");
  });
});

describe("formatSom", () => {
  it("appends the currency label", () => {
    expect(formatSom(150)).toBe("150 сом");
  });
});
