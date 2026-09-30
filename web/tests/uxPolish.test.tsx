import { describe, expect, it } from "vitest";
import { packageBlocks } from "@/features/hall/cardModel";

const MIN = 60_000;

describe("packageBlocks for any duration", () => {
  it("keeps 15-minute multiples as exact 15-minute blocks", () => {
    expect(packageBlocks(45 * MIN, 45 * MIN)).toEqual([1, 1, 1]);
    expect(packageBlocks(20 * MIN, 45 * MIN)).toEqual([1, 5 / 15, 0]);
    expect(packageBlocks(60 * MIN, 60 * MIN)).toEqual([1, 1, 1, 1]);
    expect(packageBlocks(180 * MIN, 180 * MIN)).toHaveLength(12);
  });
  it("renders 15 and 10 minute packages as one proportional block", () => {
    expect(packageBlocks(15 * MIN, 15 * MIN)).toEqual([1]);
    expect(packageBlocks(5 * MIN, 15 * MIN)).toEqual([1 / 3]);
    expect(packageBlocks(10 * MIN, 10 * MIN)).toEqual([1]);
    expect(packageBlocks(5 * MIN, 10 * MIN)).toEqual([0.5]);
    expect(packageBlocks(0, 10 * MIN)).toEqual([0]);
  });
});
