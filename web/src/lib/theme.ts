export type ThemeMode = "auto" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "ps-theme";
/** Club wall-clock hours when "По времени суток" picks light. Mirrored in index.html. */
const LIGHT_FROM_HOUR = 9;
const LIGHT_UNTIL_HOUR = 19;

export function resolveTheme(mode: ThemeMode, hour: number): Theme {
  if (mode !== "auto") return mode;
  return hour >= LIGHT_FROM_HOUR && hour < LIGHT_UNTIL_HOUR ? "light" : "dark";
}

export function parseThemeMode(value: string | null): ThemeMode {
  return value === "light" || value === "dark" || value === "auto" ? value : "auto";
}

// Storage can throw (private mode, blocked site data); the theme must still work.
export function readThemeMode(): ThemeMode {
  try {
    return parseThemeMode(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "auto";
  }
}

export function saveThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // the choice just won't survive a reload
  }
}

/** Flip instantly: fading every button through grey on a theme change looks broken. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  root.classList.add("theme-flip");
  root.dataset.theme = theme;
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-flip")));
}
