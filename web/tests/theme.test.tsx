import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeModeProvider } from "@/features/theme/ThemeModeProvider";
import { useThemeMode } from "@/features/theme/themeContext";
import { parseThemeMode, resolveTheme } from "@/lib/theme";

describe("resolveTheme", () => {
  it("follows the club clock in auto mode: light 09:00–19:00", () => {
    expect(resolveTheme("auto", 8)).toBe("dark");
    expect(resolveTheme("auto", 9)).toBe("light");
    expect(resolveTheme("auto", 18)).toBe("light");
    expect(resolveTheme("auto", 19)).toBe("dark");
    expect(resolveTheme("auto", 0)).toBe("dark");
  });

  it("returns a fixed mode unchanged", () => {
    expect(resolveTheme("light", 0)).toBe("light");
    expect(resolveTheme("dark", 12)).toBe("dark");
  });
});

describe("parseThemeMode", () => {
  it("falls back to auto for anything unknown", () => {
    expect(parseThemeMode("light")).toBe("light");
    expect(parseThemeMode(null)).toBe("auto");
    expect(parseThemeMode("sepia")).toBe("auto");
  });
});

describe("ThemeModeProvider", () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("applies the stored mode and persists a new choice", () => {
    localStorage.setItem("ps-theme", "light");
    const { result } = renderHook(() => useThemeMode(), { wrapper: ThemeModeProvider });

    expect(result.current.mode).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => result.current.setMode("dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("ps-theme")).toBe("dark");
  });
});
