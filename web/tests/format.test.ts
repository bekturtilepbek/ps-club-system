import { describe, expect, it } from "vitest";
import {
  capitalize,
  formatAmount,
  formatDuration,
  formatHoursClock,
  formatSignedSom,
  formatSom,
  pluralRu,
} from "@/lib/format";

// Amounts group thousands with a non-breaking space (U+00A0).
const NBSP = " ";

describe("formatDuration", () => {
  it("shows mm:ss under an hour", () => {
    expect(formatDuration(65_000)).toBe("01:05");
  });

  it("shows h:mm:ss from an hour on", () => {
    expect(formatDuration(3 * 3_600_000 + 104_000)).toBe("3:01:44");
  });

  it("clamps negative durations to zero", () => {
    expect(formatDuration(-5000)).toBe("00:00");
  });
});

describe("money", () => {
  it("appends the currency label", () => {
    expect(formatSom(150)).toBe("150 сом");
  });

  it("groups thousands with a non-breaking space", () => {
    expect(formatAmount(5830)).toBe(`5${NBSP}830`);
    expect(formatSom(32320)).toBe(`32${NBSP}320 сом`);
  });

  it("uses a real minus sign", () => {
    expect(formatSom(-100)).toBe("−100 сом");
  });

  it("signs a discrepancy explicitly", () => {
    expect(formatSignedSom(20)).toBe("+20 сом");
    expect(formatSignedSom(-50)).toBe("−50 сом");
    expect(formatSignedSom(0)).toBe("0 сом");
  });
});

describe("formatHoursClock", () => {
  it("shows total minutes as h:mm", () => {
    expect(formatHoursClock(2290)).toBe("38:10");
    expect(formatHoursClock(5)).toBe("0:05");
  });
});

describe("pluralRu", () => {
  const forms: [string, string, string] = ["сессия", "сессии", "сессий"];
  it("picks the Russian plural form", () => {
    expect(pluralRu(1, forms)).toBe("сессия");
    expect(pluralRu(23, forms)).toBe("сессии");
    expect(pluralRu(11, forms)).toBe("сессий");
    expect(pluralRu(25, forms)).toBe("сессий");
  });
});

describe("capitalize", () => {
  it("upper-cases the first letter only", () => {
    expect(capitalize("вода × 2, сникерс")).toBe("Вода × 2, сникерс");
  });
});
