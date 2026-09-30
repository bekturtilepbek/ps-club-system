import { describe, expect, it } from "vitest";
import { BLOCK_MS, STATUS_VISUALS, hallColumns, packageBlocks } from "@/features/hall/cardModel";

const H = 3_600_000;

describe("packageBlocks", () => {
  it("lights every 15-minute block of a fresh 3-hour package", () => {
    expect(packageBlocks(3 * H, 3 * H)).toEqual(Array(12).fill(1));
  });

  it("drains from the right: 3:44 left of 1 hour is one partly lit block", () => {
    const fills = packageBlocks(224_000, H);
    expect(fills).toHaveLength(4);
    expect(fills[0]).toBeCloseTo(224_000 / BLOCK_MS);
    expect(fills.slice(1)).toEqual([0, 0, 0]);
  });

  it("counts a package with its 3-minute grace as whole blocks", () => {
    expect(packageBlocks(3 * H, 3 * H + 3 * 60_000)).toHaveLength(12);
  });

  it("never goes below zero", () => {
    expect(packageBlocks(-5000, H)).toEqual([0, 0, 0, 0]);
  });
});

describe("hallColumns", () => {
  it("keeps the grid free of holes for the club's console counts", () => {
    expect(hallColumns(1)).toBe(1);
    expect(hallColumns(3)).toBe(3);
    expect(hallColumns(4)).toBe(3);
    expect(hallColumns(6)).toBe(3);
    expect(hallColumns(8)).toBe(4);
    expect(hallColumns(12)).toBe(5);
  });
});

describe("STATUS_VISUALS", () => {
  it("gives every loud state a glyph so colour is never the only signal", () => {
    for (const visual of Object.values(STATUS_VISUALS)) {
      if (visual.loud) expect(visual.glyph).not.toBe("");
    }
    expect(STATUS_VISUALS.package_overtime).toMatchObject({ tone: "circle", glyph: "○", label: "Переигрыш" });
  });
});
