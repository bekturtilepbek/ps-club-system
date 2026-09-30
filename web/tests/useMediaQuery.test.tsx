import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "@/lib/useMediaQuery";

describe("useMediaQuery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is false where matchMedia does not exist", () => {
    expect(renderHook(() => useMediaQuery("(min-width: 1680px)")).result.current).toBe(false);
  });

  it("follows matchMedia", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    expect(renderHook(() => useMediaQuery("(min-width: 1680px)")).result.current).toBe(true);
  });
});
