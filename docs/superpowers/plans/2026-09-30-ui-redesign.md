# UI Redesign («Световая полоса») Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the agreed design concept into the real `web/` app: new design tokens, fonts, dark and light themes, the redesigned console card, side sheets instead of centred dialogs, a session details sheet, the till in the top bar, the history page, and the redesigned login and open-day screens. Part 1 (Tasks 1–12) runs on the current API. Part 2 (Tasks 13–20) adds what the concept needs from the backend: the day's event feed, idle time on free consoles, bar categories, and per-day totals with free hours in the history.

**Architecture:** The redesign is a presentation-layer change on top of logic that stays put. `remainingTime.ts`, `useHallSnapshot`, `useSessionActions`, and the dialog state machine in `HallPage` (settle after stop, return to close-day) keep their behaviour. New visuals come from CSS-variable tokens in `index.css`, mapped into Tailwind and aliased onto the shadcn token names so untouched primitives follow the theme. Per-element status colour is a `data-tone` attribute that exposes `--c`. New pure helpers (`lib/bishkek.ts`, `features/hall/cardModel.ts`, `barLines.ts`, `sessionTimeline.ts`) carry every decision a test can pin down without rendering. Sheets are Radix Dialog underneath, so roles, focus trapping and `aria-hidden` on the page behind them behave exactly like today's dialogs.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind 3.4, shadcn/ui (Radix), TanStack Query 5, vitest + Testing Library, lucide-react. New: `@fontsource/golos-text`, `@fontsource/unbounded`, `@fontsource/jetbrains-mono`.

**Spec:** `docs/design/concept-hall-v2.html` is the visual reference. Open it in a browser; deep links are `#bar-2`, `#ticket`, `#history`, `#history-0`, `#login`, `#day`, and `?theme=light`. `docs/design/SYSTEM_BRIEF.md` holds vocabulary and rules. `CLAUDE.md` domain rules still apply.

## Global Constraints

- **Part 1 (Tasks 1–12) makes no backend changes:** no new endpoints, no schema or migration changes, and `src/types/api.ts` is not regenerated there. If a Part 1 step seems to need a backend change, stop and report it.
- **Part 2 (Tasks 13–20) changes the backend exactly as specified:** two migrations (`session_segments.created_at`, `products.category`), a feed endpoint, and extra fields on existing responses. Task 17 regenerates the frontend types. Existing responses only gain fields; nothing is removed or renamed, so the bot and the current UI keep working.
- **Business behaviour is frozen.** `remainingTime.ts`, `useHallSnapshot.ts`, `useSessionActions.ts`, `useAlertSound.ts`, `money.ts`, `plannedClose.ts` (except the one import in Task 1), and the settle / close-day flow in `HallPage.tsx` keep their current behaviour. Existing tests keep their intent; a task may change only copy and selectors in them, exactly as its steps list.
- **Language:** UI copy in Russian; code, identifiers and comments in English.
- **Testing money in accessible names:** `getByText` collapses the non-breaking thousands space, but `getByRole({ name })` does not. Match amounts ≥ 1000 in role names with a regex such as `/2\s000/`.
- **Money** is formatted only through `formatSom` / `formatAmount` / `formatSignedSom` (Task 1): whole som, non-breaking-space thousands (`5 830`), real minus sign `−`.
- **Time** is formatted only through `lib/bishkek.ts` (Task 1). Asia/Bishkek is a fixed UTC+6.
- **Cash and non-cash are never summed** into one figure anywhere.
- **Status tones** (DualSense face buttons), set as `data-tone`:

  | Status | Tone | Glyph | Label |
  |---|---|---|---|
  | free, maintenance | `idle` | — | Свободна / Обслуживание |
  | package_running | `cross` | ✕ | Пакет |
  | package_warn | `amber` | ! | Скоро конец |
  | package_overtime | `circle` | ○ | Переигрыш |
  | open_running | `triangle` | △ | Открытое время |
  | free_session | `square` | □ | Бесплатная |
  | service_session | `muted` | — | Служебная |

- **Amber means time only:** the last minutes of a package, or a package ending after planned close. Money due is shown neutrally (`text-fg`, bold).
- **Colour is never the only carrier of status:** every tone comes with a glyph or a label.
- **Themes:** dark is the default. Modes are `auto | light | dark`, stored under the localStorage key `ps-theme`. `auto` means light from 09:00 until 19:00 on the club clock (Bishkek), dark otherwise.
- **Accessibility floor:** visible focus, `prefers-reduced-motion` respected, click targets ≥ 40px, text contrast ≥ WCAG AA (the token values below are already checked).
- **Commands** run from `web/`: `npm test`, `npm run lint`, `npm run build`. Every task ends with all three green.
- **Commits:** English, imperative, one logical change per task. No `Co-Authored-By`, no generated-by lines.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/lib/bishkek.ts` | club wall clock: hour, `HH:MM`, `ср, 30.09` | 1 |
| `src/lib/format.ts` | durations, som, signed som, hours clock, plural, capitalize | 1 |
| `src/index.css`, `tailwind.config.ts`, `index.html`, `src/main.tsx` | tokens, fonts, theme bootstrap | 2 |
| `src/lib/theme.ts` | pure theme resolution and persistence | 2 |
| `src/features/theme/themeContext.ts`, `ThemeModeProvider.tsx` | theme mode state and its hook | 2 |
| `src/components/ui/{tone.ts,button.tsx,sheet.tsx,state-chip.tsx,segmented.tsx,dialog.tsx}` | primitives | 3 |
| `src/features/hall/cardModel.ts` | status visuals, 15-minute blocks, grid columns | 4 |
| `src/features/hall/barLines.ts` | grouping and summarising bar orders | 4 |
| `src/features/hall/sessionTimeline.ts` | the rows of the session details timeline | 4 |
| `src/features/hall/SessionSheet.tsx` | session details sheet | 5 |
| `src/features/hall/{TopBar,Till,HallHelp}.tsx`, `src/features/theme/ThemeSwitch.tsx` | hall shell | 6 |
| `src/features/hall/ConsoleCard.tsx`, `useHallHotkeys.ts` | card redesign, hotkeys | 7 |
| `src/features/hall/{TariffTile,StartSessionDialog,ExtendSessionDialog,LatePackageWarning}.tsx` | start and extend sheets | 8 |
| `src/features/hall/{PaymentDialog,BarDialog}.tsx` | payment and bar sheets | 9 |
| `src/features/hall/CloseBusinessDayDialog.tsx` | close-day steps | 10 |
| `src/features/hall/HistoryPage.tsx` (replaces `BusinessDayHistoryDialog.tsx`) | history page and day sheet | 11 |
| `src/features/auth/LoginPage.tsx`, `src/features/hall/BusinessDayGuard.tsx` | login and open-day gate | 12 |
| `core/services/business_days.py`, `core/api/{schemas,routes}/business_days.py` | batched day summaries, history totals, free minutes | 13 |
| `core/services/hall.py`, `core/api/schemas/hall.py` | `free_since` per console | 14 |
| `core/db/models/sessions.py` (+ migration), `core/services/{sessions,feed}.py`, `core/api/schemas/feed.py` | segment `created_at`, the day feed | 15 |
| `core/db/models/bar.py` (+ migration), `core/api/{schemas/bar,admin}.py` | product category | 16 |
| `src/types/api.ts`, `src/lib/api.ts`, `HistoryPage.tsx` | regenerated types, history totals | 17 |
| `ConsoleCard.tsx`, `lib/format.ts` | idle time | 18 |
| `barLines.ts`, `BarDialog.tsx` | category tabs | 19 |
| `feedModel.ts`, `DayFeed.tsx`, `lib/useMediaQuery.ts`, `HallPage.tsx` | the day feed | 20 |

---

### Task 1: Club clock and number formatting

**Files:**
- Create: `web/src/lib/bishkek.ts`
- Modify: `web/src/lib/format.ts`
- Modify: `web/src/features/hall/plannedClose.ts` (import the offset instead of redeclaring it)
- Test: `web/tests/bishkek.test.ts` (new), `web/tests/format.test.ts`
- Test (copy only): `web/tests/CloseBusinessDayDialog.test.tsx`, `web/tests/BusinessDayHistoryDialog.test.tsx`, `web/tests/HallPage.test.tsx`

**Interfaces:**
- Produces: `BISHKEK_UTC_OFFSET_MS: number`, `bishkekHour(ms: number): number`, `formatClock(ms: number): string` (`"00:40"`), `formatDayLabel(ms: number): string` (`"ср, 30.09"`).
- Produces: `formatDuration(ms)` (`"3:01:44"`, `"05:09"`), `formatAmount(n)` (`"5 830"`, `"−100"`), `formatSom(n)` (`"5 830 сом"`), `formatSignedSom(n)` (`"+20 сом"`, `"−50 сом"`, `"0 сом"`), `formatHoursClock(minutes)` (`"38:10"`), `formatHoursMinutes` (unchanged), `pluralRu(n, [one, few, many])`, `capitalize(text)`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/bishkek.test.ts
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
```

Replace `web/tests/format.test.ts` entirely:

```ts
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
    expect(formatAmount(5830)).toBe("5 830");
    expect(formatSom(32320)).toBe("32 320 сом");
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/bishkek.test.ts tests/format.test.ts`
Expected: FAIL — `@/lib/bishkek` does not exist, and the new `format` exports are missing.

- [ ] **Step 3: Implement**

```ts
// web/src/lib/bishkek.ts
// Asia/Bishkek has had no DST since 2005: a fixed UTC+6 offset, so no timezone library.
export const BISHKEK_UTC_OFFSET_MS = 6 * 60 * 60_000;

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function wallClock(ms: number): Date {
  return new Date(ms + BISHKEK_UTC_OFFSET_MS);
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

/** Hour of day (0–23) on the club's wall clock. */
export function bishkekHour(ms: number): number {
  return wallClock(ms).getUTCHours();
}

/** "HH:MM" on the club's wall clock. */
export function formatClock(ms: number): string {
  const date = wallClock(ms);
  return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

/** "ср, 30.09" on the club's wall clock. */
export function formatDayLabel(ms: number): string {
  const date = wallClock(ms);
  return `${WEEKDAYS[date.getUTCDay()]}, ${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)}`;
}
```

Replace `web/src/lib/format.ts` entirely:

```ts
const NBSP = " ";
const MINUS = "−";

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

/** The hall's timer format: "3:01:44" from an hour on, "05:09" below. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const minutesSeconds = `${pad2(minutes)}:${pad2(seconds)}`;
  return hours > 0 ? `${hours}:${minutesSeconds}` : minutesSeconds;
}

/** Whole som, thousands split by a non-breaking space so "5 830" never wraps. */
export function formatAmount(amount: number): string {
  const digits = Math.abs(Math.round(amount))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return amount < 0 ? `${MINUS}${digits}` : digits;
}

export function formatSom(amount: number): string {
  return `${formatAmount(amount)} сом`;
}

/** A discrepancy: always signed, so "+20" and "−50" read differently at a glance. */
export function formatSignedSom(amount: number): string {
  return amount > 0 ? `+${formatSom(amount)}` : formatSom(amount);
}

export function formatHoursMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} ч ${minutes} мин`;
}

/** Total minutes as a compact "38:10" for tables. */
export function formatHoursClock(totalMinutes: number): string {
  return `${Math.floor(totalMinutes / 60)}:${pad2(totalMinutes % 60)}`;
}

export function pluralRu(count: number, [one, few, many]: [string, string, string]): string {
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
```

In `web/src/features/hall/plannedClose.ts`, delete the local constant and its comment, and import it instead:

```ts
import { BISHKEK_UTC_OFFSET_MS } from "@/lib/bishkek";
```

(Remove the two lines `// Asia/Bishkek has had no DST since 2005 …` / `const BISHKEK_UTC_OFFSET_MS = 6 * 60 * 60_000;`. The rest of the file is unchanged.)

- [ ] **Step 4: Update copy-only assertions broken by the new money format**

Testing Library collapses the non-breaking space to a normal space, so assertions use plain spaces.

| File | Old | New |
|---|---|---|
| `tests/CloseBusinessDayDialog.test.tsx` | `"Наличные ожидается: 5300 сом"` | `"Наличные ожидается: 5 300 сом"` |
| `tests/CloseBusinessDayDialog.test.tsx` | `/Расхождение: -100 сом/` | `/Расхождение: −100 сом/` |
| `tests/BusinessDayHistoryDialog.test.tsx` | `/Начало: 5000 сом · Ожидалось: 5300 сом · Посчитано: 5200 сом/` | `/Начало: 5 000 сом · Ожидалось: 5 300 сом · Посчитано: 5 200 сом/` |
| `tests/BusinessDayHistoryDialog.test.tsx` | `/Расхождение: -100 сом/` | `/Расхождение: −100 сом/` |
| `tests/HallPage.test.tsx` (2×) | `"Наличные ожидается: 5000 сом"` | `"Наличные ожидается: 5 000 сом"` |
| `tests/HallPage.test.tsx` | `/Начало: 1000 сом/` | `/Начало: 1 000 сом/` |

- [ ] **Step 5: Run everything**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS. If another assertion fails only because of `formatDuration` or thousands formatting, update its literal the same way and note it in the commit body.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/bishkek.ts web/src/lib/format.ts web/src/features/hall/plannedClose.ts web/tests
git commit -m "Add club-clock helpers and grouped money formatting"
```

---

### Task 2: Design tokens, fonts and theme modes

**Files:**
- Modify: `web/package.json` (+ lock file) — three font packages
- Modify: `web/index.html`, `web/src/index.css`, `web/tailwind.config.ts`, `web/src/main.tsx`, `web/src/App.tsx`
- Create: `web/src/lib/theme.ts`, `web/src/features/theme/themeContext.ts`, `web/src/features/theme/ThemeModeProvider.tsx`
- Test: `web/tests/theme.test.tsx`

**Interfaces:**
- Consumes: `bishkekHour` (Task 1), `serverNow` (`lib/clock.ts`).
- Produces: `type ThemeMode = "auto" | "light" | "dark"`, `type Theme = "light" | "dark"`, `THEME_STORAGE_KEY = "ps-theme"`, `resolveTheme(mode, hour): Theme`, `parseThemeMode(value: string | null): ThemeMode`, `readThemeMode(): ThemeMode`, `saveThemeMode(mode): void`, `applyTheme(theme): void`, `<ThemeModeProvider>`, `useThemeMode(): { mode: ThemeMode; setMode(mode: ThemeMode): void }`.
- Produces (Tailwind): colours `bg`, `surface`, `surface-2`, `line`, `fg`, `fg-muted`, `fg-faint`, `ink`, `hover`, `hover-line`, `rail`, `status-{cross,triangle,circle,square,amber,amber-text,idle}`, `tone` (= `hsl(var(--c))`); fonts `font-sans` (Golos Text), `font-display` (Unbounded), `font-mono` (JetBrains Mono); screen `short:` (height ≤ 820px and width ≥ 1101px); animations `animate-breathe`, `animate-breathe-fast`, `animate-flow`; utilities `.num`, `.field-label`, `.note`, `.note-warn`, `.text-on-tone`, `.text-tone-soft`.

- [ ] **Step 1: Install the fonts**

The fonts are self-hosted because in the local deployment variant the till PC may be offline (`docs/SPEC.md` §5.2).

Run: `npm install @fontsource/golos-text @fontsource/unbounded @fontsource/jetbrains-mono`

- [ ] **Step 2: Write the failing test**

```tsx
// web/tests/theme.test.tsx
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- tests/theme.test.tsx`
Expected: FAIL — the modules do not exist.

- [ ] **Step 4: Implement the theme logic**

```ts
// web/src/lib/theme.ts
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
```

```ts
// web/src/features/theme/themeContext.ts
import { createContext, useContext } from "react";
import type { ThemeMode } from "@/lib/theme";

export interface ThemeModeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

export function useThemeMode(): ThemeModeContextValue {
  const context = useContext(ThemeModeContext);
  if (!context) throw new Error("useThemeMode must be used inside <ThemeModeProvider>");
  return context;
}
```

```tsx
// web/src/features/theme/ThemeModeProvider.tsx
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { bishkekHour } from "@/lib/bishkek";
import { serverNow } from "@/lib/clock";
import { applyTheme, readThemeMode, resolveTheme, saveThemeMode, type ThemeMode } from "@/lib/theme";
import { ThemeModeContext } from "./themeContext";

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readThemeMode);

  useEffect(() => {
    const sync = () => applyTheme(resolveTheme(mode, bishkekHour(serverNow())));
    sync();
    // "auto" flips at 09:00 and 19:00; a minute of lag is fine.
    const timer = setInterval(sync, 60_000);
    return () => clearInterval(timer);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    saveThemeMode(next);
    setModeState(next);
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}
```

`web/src/App.tsx` — wrap everything in the provider (the login screen is themed too):

```tsx
import { LoginPage } from "@/features/auth/LoginPage";
import { useAuth } from "@/features/auth/useAuth";
import { HallPage } from "@/features/hall/HallPage";
import { ThemeModeProvider } from "@/features/theme/ThemeModeProvider";

function Screen() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <div className="p-4">Загрузка…</div>;
  if (!isAuthenticated) return <LoginPage />;

  return <HallPage />;
}

function App() {
  return (
    <ThemeModeProvider>
      <Screen />
    </ThemeModeProvider>
  );
}

export default App;
```

- [ ] **Step 5: Tokens, fonts and the pre-paint theme script**

`web/src/main.tsx` — add the font imports above `./index.css`:

```ts
import "@fontsource/golos-text/400.css";
import "@fontsource/golos-text/500.css";
import "@fontsource/golos-text/600.css";
import "@fontsource/golos-text/700.css";
import "@fontsource/unbounded/600.css";
import "@fontsource/unbounded/700.css";
import "@fontsource/unbounded/800.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/jetbrains-mono/800.css";
```

`web/index.html` — `lang="ru"`, `color-scheme` meta, and the theme set before the first paint:

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark light" />
    <title>PS Club</title>
    <script>
      // Set the theme before the first paint so the page never flashes the wrong one.
      // Keep in sync with src/lib/theme.ts (key, 09–19 light) and src/lib/bishkek.ts (UTC+6).
      (function () {
        var mode = "auto";
        try { mode = localStorage.getItem("ps-theme") || "auto"; } catch (e) {}
        var hour = new Date(Date.now() + 6 * 3600000).getUTCHours();
        document.documentElement.dataset.theme =
          mode === "light" || mode === "dark" ? mode : hour >= 9 && hour < 19 ? "light" : "dark";
      })();
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Replace `web/src/index.css` entirely. Values are HSL triplets of the concept palette; contrast is already checked.

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/*
  Design tokens — see docs/design/concept-hall-v2.html.
  Dark is the default: the club runs 10:00–05:00 in a dim room.
  HSL triplets so Tailwind opacity modifiers work (bg-status-cross/15).
*/
@layer base {
  :root {
    --bg: 222 31.2% 6.3%;
    --surface: 222.4 32.1% 10.4%;
    --surface-2: 222.5 32.4% 14.5%;
    --line: 221.5 26.5% 19.2%;
    --fg: 220 37.5% 93.7%;
    --fg-muted: 221.4 14.3% 60.2%;
    --fg-faint: 222.6 13.2% 53.9%;
    --ink: 222 31.2% 6.3%;
    --hover: 222.2 29.7% 17.8%;
    --hover-line: 221.8 25.2% 25.7%;
    --rail: 221.5 31.7% 8%;

    /* Status colours are the DualSense face buttons ✕ △ ○ □, plus amber for time. */
    --cross: 222.1 100% 67.8%;
    --triangle: 167.1 65.1% 53.9%;
    --circle: 353 100% 66.5%;
    --square: 310.5 69.4% 69.2%;
    --amber: 35.9 100% 63.9%;
    --amber-text: 35.9 100% 63.9%;
    --idle: 222.6 21.4% 28.4%;
    --on-amber: 45 100% 5%;
    --tint-to: 0 0% 100%;
    --shadow-lg: 0 30px 80px rgb(0 0 0 / 0.5);

    /* shadcn/ui aliases: primitives we have not restyled still follow the theme */
    --background: var(--bg);
    --foreground: var(--fg);
    --card: var(--surface);
    --card-foreground: var(--fg);
    --popover: var(--surface);
    --popover-foreground: var(--fg);
    --primary: var(--fg);
    --primary-foreground: var(--ink);
    --secondary: var(--surface-2);
    --secondary-foreground: var(--fg);
    --muted: var(--surface-2);
    --muted-foreground: var(--fg-muted);
    --accent: var(--hover);
    --accent-foreground: var(--fg);
    --destructive: var(--circle);
    --destructive-foreground: var(--ink);
    --border: var(--line);
    --input: var(--line);
    --ring: var(--cross);
    --radius: 0.875rem;
    color-scheme: dark;
  }

  /* Daytime. Status colours are darker so text on white passes WCAG AA;
     amber stays bright for fills and --amber-text carries it as text. */
  :root[data-theme="light"] {
    --bg: 217.5 28.6% 94.5%;
    --surface: 0 0% 100%;
    --surface-2: 214.3 33.3% 95.9%;
    --line: 216 24.6% 88%;
    --fg: 218.8 33.3% 10%;
    --fg-muted: 220.6 15.6% 39%;
    --fg-faint: 221.4 12.8% 44.5%;
    --ink: 0 0% 100%;
    --hover: 215 28.6% 91.8%;
    --hover-line: 217.1 21.2% 80.6%;
    --rail: 216 38.5% 97.5%;
    --cross: 222.7 76.3% 53.7%;
    --triangle: 169.8 86.1% 28.2%;
    --circle: 350.5 66.9% 49.8%;
    --square: 308.4 52.4% 45.3%;
    --amber: 38.1 90.8% 53.3%;
    --amber-text: 36.6 100% 29.2%;
    --idle: 217.9 18.4% 79.8%;
    --tint-to: 0 0% 0%;
    --shadow-lg: 0 24px 64px rgb(20 30 50 / 0.16);
    color-scheme: light;
  }

  /* <el data-tone="cross"> exposes --c; children use hsl(var(--c)) via the `tone` colour */
  [data-tone="cross"] { --c: var(--cross); }
  [data-tone="triangle"] { --c: var(--triangle); }
  [data-tone="circle"] { --c: var(--circle); }
  [data-tone="square"] { --c: var(--square); }
  [data-tone="amber"] { --c: var(--amber); --on-c: var(--on-amber); }
  [data-tone="idle"] { --c: var(--idle); }
  [data-tone="muted"] { --c: var(--fg-muted); }

  * {
    @apply border-border;
  }
  body {
    @apply bg-bg font-sans text-fg antialiased;
  }
  :focus-visible {
    outline: 2px solid hsl(var(--cross));
    outline-offset: 2px;
  }
}

@layer components {
  .num {
    @apply font-mono;
    font-variant-numeric: tabular-nums;
  }
  .field-label {
    @apply mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-fg-muted;
  }
  .note {
    @apply rounded-[10px] border border-line bg-bg px-3 py-2.5 text-[13px] text-fg-muted;
  }
  .note-warn {
    @apply text-fg;
    border-color: hsl(var(--amber) / 0.45);
  }
}

@layer utilities {
  .text-on-tone {
    color: hsl(var(--on-c, var(--ink)));
  }
  .text-tone-soft {
    color: color-mix(in srgb, hsl(var(--c)) 70%, hsl(var(--tint-to)));
  }
  .theme-flip *,
  .theme-flip *::before,
  .theme-flip *::after {
    transition: none !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
  }
}
```

Replace `web/tailwind.config.ts` entirely:

```ts
import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      screens: {
        // a 1366×768 till monitor: both rows of consoles must fit without scrolling
        short: { raw: "(max-height: 820px) and (min-width: 1101px)" },
      },
      fontFamily: {
        sans: ['"Golos Text"', "system-ui", "sans-serif"],
        display: ["Unbounded", '"Golos Text"', "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        bg: token("bg"),
        surface: { DEFAULT: token("surface"), 2: token("surface-2") },
        line: token("line"),
        fg: { DEFAULT: token("fg"), muted: token("fg-muted"), faint: token("fg-faint") },
        ink: token("ink"),
        hover: { DEFAULT: token("hover"), line: token("hover-line") },
        rail: token("rail"),
        status: {
          cross: token("cross"),
          triangle: token("triangle"),
          circle: token("circle"),
          square: token("square"),
          amber: token("amber"),
          "amber-text": token("amber-text"),
          idle: token("idle"),
        },
        tone: "hsl(var(--c) / <alpha-value>)",
        // shadcn/ui names
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        breathe: { "50%": { opacity: "0.35" } },
        flow: { to: { backgroundPosition: "16px 0" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        breathe: "breathe 2.4s ease-in-out infinite",
        "breathe-fast": "breathe 1s ease-in-out infinite",
        flow: "flow 1.2s linear infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
```

- [ ] **Step 6: Run everything**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS. `App.test.tsx` still passes: `App` now wraps its screens in the provider.

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json web/index.html web/src web/tailwind.config.ts web/tests/theme.test.tsx
git commit -m "Add design tokens, self-hosted fonts and theme modes"
```

---

### Task 3: UI primitives — button, sheet, state chip, segmented control

**Files:**
- Create: `web/src/components/ui/tone.ts`, `web/src/components/ui/sheet.tsx`, `web/src/components/ui/state-chip.tsx`, `web/src/components/ui/segmented.tsx`
- Modify: `web/src/components/ui/button.tsx`, `web/src/components/ui/dialog.tsx`
- Test: `web/tests/primitives.test.tsx`

**Interfaces:**
- Produces: `type Tone = "cross" | "triangle" | "circle" | "square" | "amber" | "idle" | "muted"`.
- Produces: `Button` gains `variant="state"` (fill = the nearest `data-tone`), restyled other variants, sizes `default | sm | lg | icon`; `buttonVariants` is still exported.
- Produces: `Sheet` (Radix Dialog Root), `SheetContent` (`tone?: Tone`), `SheetHeader` (includes the close button «Закрыть»), `SheetTitle`, `SheetBody`, `SheetFooter`.
- Produces: `StateChip({ tone, glyph?, loud?, className?, children })`.
- Produces: `SegmentedControl<T extends string>({ options: { value: T; label: ReactNode }[]; value: T; onChange(value: T): void; ariaLabel: string })` — buttons with `aria-pressed`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/tests/primitives.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "@/components/ui/segmented";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StateChip } from "@/components/ui/state-chip";

describe("Sheet", () => {
  it("renders a titled side panel with a Russian close button", () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent tone="cross">
          <SheetHeader>
            <SheetTitle>PS 1</SheetTitle>
          </SheetHeader>
          <SheetBody>тело</SheetBody>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.getByRole("dialog", { name: "PS 1" })).toHaveAttribute("data-tone", "cross");
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("SegmentedControl", () => {
  it("marks the current option and reports a new choice", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Способ оплаты"
        value="cash"
        onChange={onChange}
        options={[
          { value: "cash", label: "Наличные" },
          { value: "qr", label: "QR" },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Наличные" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "QR" }));
    expect(onChange).toHaveBeenCalledWith("qr");
  });
});

describe("StateChip", () => {
  it("hides the glyph from screen readers and keeps the label", () => {
    render(
      <StateChip tone="circle" glyph="○" loud>
        Переигрыш
      </StateChip>,
    );
    expect(screen.getByText("Переигрыш").closest("[data-tone]")).toHaveAttribute("data-tone", "circle");
    expect(screen.getByText("○")).toHaveAttribute("aria-hidden", "true");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/primitives.test.tsx`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement**

```ts
// web/src/components/ui/tone.ts
/** Status colour of a card, chip or button. Rendered as data-tone; see index.css. */
export type Tone = "cross" | "triangle" | "circle" | "square" | "amber" | "idle" | "muted";
```

In `web/src/components/ui/button.tsx`, replace the `buttonVariants` definition (the rest of the file is unchanged):

```ts
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-fg bg-fg font-semibold text-ink hover:opacity-90",
        destructive: "border-status-circle bg-status-circle font-semibold text-ink hover:opacity-90",
        outline: "border-line bg-surface-2 text-fg hover:border-hover-line hover:bg-hover",
        secondary: "border-line bg-surface-2 text-fg hover:bg-hover",
        ghost: "border-transparent bg-transparent text-fg-muted hover:bg-surface hover:text-fg",
        link: "border-transparent text-fg underline-offset-4 hover:underline",
        // The primary action wears its card's colour: set data-tone on the button or an ancestor.
        state: "border-tone bg-tone font-semibold text-on-tone hover:brightness-110",
      },
      size: {
        default: "h-10 px-3.5",
        sm: "h-9 px-3",
        lg: "h-12 rounded-xl px-5 text-[15px]",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)
```

```tsx
// web/src/components/ui/sheet.tsx
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tone } from "./tone";

/** A side panel (bottom sheet on phones). Radix Dialog underneath: same roles and focus trap. */
const Sheet = DialogPrimitive.Root;
const SheetClose = DialogPrimitive.Close;

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { tone?: Tone }
>(({ className, children, tone = "idle", ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
    <DialogPrimitive.Content
      ref={ref}
      data-tone={tone}
      aria-describedby={undefined}
      className={cn(
        "fixed z-50 flex flex-col border-line bg-surface text-fg shadow-[var(--shadow-lg)] outline-none",
        "inset-x-0 bottom-0 h-[88vh] rounded-t-2xl border-t",
        "sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:w-[460px] sm:rounded-none sm:border-l sm:border-t-0",
        "data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom sm:data-[state=closed]:slide-out-to-right sm:data-[state=open]:slide-in-from-right",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";

function SheetHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("relative flex items-center gap-3 border-b border-line px-5 py-4", className)} {...props}>
      <span aria-hidden className="absolute bottom-4 left-0 top-4 w-[3px] rounded-r bg-tone shadow-[0_0_12px_hsl(var(--c))]" />
      {children}
      <DialogPrimitive.Close className="ml-auto inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-fg-muted hover:bg-hover hover:text-fg">
        <X className="h-4 w-4" />
        <span className="sr-only">Закрыть</span>
      </DialogPrimitive.Close>
    </div>
  );
}

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("font-display text-xl font-bold tracking-tight", className)} {...props} />
));
SheetTitle.displayName = "SheetTitle";

function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid flex-1 content-start gap-6 overflow-y-auto p-5", className)} {...props} />;
}

function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex gap-2 border-t border-line px-5 py-4 [&>*]:flex-1", className)} {...props} />;
}

export { Sheet, SheetBody, SheetClose, SheetContent, SheetFooter, SheetHeader, SheetTitle };
```

```tsx
// web/src/components/ui/state-chip.tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "./tone";

interface StateChipProps {
  tone: Tone;
  /** A face-button shape, so the status never relies on colour alone. */
  glyph?: string;
  /** Solid fill for the states that must be seen from across the room. */
  loud?: boolean;
  className?: string;
  children: ReactNode;
}

export function StateChip({ tone, glyph, loud = false, className, children }: StateChipProps) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full py-0.5 pl-1.5 pr-2.5 text-[12.5px] font-medium",
        loud ? "bg-tone font-semibold text-on-tone" : "bg-tone/15 text-tone-soft",
        className,
      )}
    >
      {glyph && (
        <span aria-hidden="true" className="grid h-4 w-4 place-items-center text-xs font-bold">
          {glyph}
        </span>
      )}
      {children}
    </span>
  );
}
```

```tsx
// web/src/components/ui/segmented.tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SegmentedControlProps<T extends string> {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}

export function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel }: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={ariaLabel} className="grid auto-cols-fr grid-flow-col rounded-xl border border-line bg-bg p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-[38px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] text-sm font-medium text-fg-muted transition-colors hover:text-fg",
            value === option.value && "bg-surface-2 text-fg shadow-sm",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
```

In `web/src/components/ui/dialog.tsx`:
- In `DialogOverlay`, change `bg-black/80` to `bg-black/60`.
- In `DialogContent`, change `border bg-background p-6 shadow-lg` to `border border-line bg-surface p-6 text-fg shadow-[var(--shadow-lg)]`, and `sm:rounded-lg` to `sm:rounded-2xl`.
- Change `<span className="sr-only">Close</span>` to `<span className="sr-only">Закрыть</span>`.

- [ ] **Step 4: Run everything**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ui web/tests/primitives.test.tsx
git commit -m "Add sheet, state chip and segmented control primitives"
```

---

### Task 4: Pure hall helpers — status visuals, blocks, bar lines, timeline

**Files:**
- Create: `web/src/features/hall/cardModel.ts`, `web/src/features/hall/barLines.ts`, `web/src/features/hall/sessionTimeline.ts`
- Test: `web/tests/cardModel.test.ts`, `web/tests/barLines.test.ts`, `web/tests/sessionTimeline.test.ts`

**Interfaces:**
- Consumes: `CardStatus` (`remainingTime.ts`), `Tone` (Task 3), `formatClock` (Task 1), `formatAmount` (Task 1), `OrderResponse`, `SessionResponse` (`lib/api.ts`).
- Produces: `STATUS_VISUALS: Record<CardStatus, { tone: Tone; glyph: string; label: string; loud: boolean }>`, `BLOCK_MS = 900_000`, `packageBlocks(remainingMs: number, segmentMs: number): number[]`, `hallColumns(count: number): number`.
- Produces: `interface BarLine { productId: number; qty: number; total: number; removableOrderId: number }`, `groupOrders(orders): BarLine[]`, `ordersTotal(orders): number`, `summarizeOrders(orders, productName: (id: number) => string): string`.
- Produces: `interface TimelineRow { key: string; atMs: number; title: string; note: string; amount: number | null; tone: Tone }`, `sessionTimeline(session, tariffName: (tariffId: number | null) => string | undefined, nowMs: number): TimelineRow[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/cardModel.test.ts
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
```

```ts
// web/tests/barLines.test.ts
import { describe, expect, it } from "vitest";
import { groupOrders, ordersTotal, summarizeOrders } from "@/features/hall/barLines";
import type { OrderResponse } from "@/lib/api";

function order(id: number, productId: number, qty: number, unitPrice: number, minute: number): OrderResponse {
  return {
    id,
    session_id: 5,
    product_id: productId,
    qty,
    unit_price: unitPrice,
    created_at: `2026-09-30T10:${minute.toString().padStart(2, "0")}:00Z`,
  };
}

const NAMES: Record<number, string> = { 1: "Кола 0,5", 2: "Сэндвич" };
const name = (id: number) => NAMES[id];

describe("groupOrders", () => {
  it("merges rows of one product, in the order products were first added", () => {
    const lines = groupOrders([order(1, 1, 1, 60, 1), order(2, 2, 1, 120, 2), order(3, 1, 1, 60, 3)]);
    expect(lines).toEqual([
      { productId: 1, qty: 2, total: 120, removableOrderId: 3 },
      { productId: 2, qty: 1, total: 120, removableOrderId: 2 },
    ]);
  });

  it("removes a single-unit row before a multi-unit one", () => {
    const lines = groupOrders([order(1, 1, 1, 60, 1), order(2, 1, 3, 60, 2)]);
    expect(lines[0].removableOrderId).toBe(1);
  });
});

describe("summaries", () => {
  it("totals and describes the bar tab", () => {
    const orders = [order(1, 1, 1, 60, 1), order(2, 2, 1, 120, 2), order(3, 1, 1, 60, 3)];
    expect(ordersTotal(orders)).toBe(240);
    expect(summarizeOrders(orders, name)).toBe("кола 0,5 × 2, сэндвич");
  });
});
```

```ts
// web/tests/sessionTimeline.test.ts
import { describe, expect, it } from "vitest";
import { sessionTimeline } from "@/features/hall/sessionTimeline";
import type { SessionResponse } from "@/lib/api";

function session(overrides: Partial<SessionResponse>): SessionResponse {
  return {
    id: 7,
    console_id: 3,
    business_day_id: 1,
    kind: "paid",
    reason: null,
    status: "active",
    started_at: "2026-09-29T14:31:00Z",
    grace_until: "2026-09-29T14:34:00Z",
    ended_at: null,
    comment: null,
    segments: [],
    orders: [],
    charge_total: 0,
    paid_total: 0,
    balance: 0,
    ...overrides,
  };
}

const tariffName = (id: number | null) => ({ 1: "3 часа", 2: "1 час" } as Record<number, string>)[id ?? 0];

describe("sessionTimeline", () => {
  it("lists grace, the package, an extension and a running overtime", () => {
    const rows = sessionTimeline(
      session({
        segments: [
          { id: 1, tariff_id: 1, kind: "package", starts_at: "2026-09-29T14:31:00Z", ends_at: "2026-09-29T17:34:00Z", price_snapshot: 400, amount: 400 },
          { id: 2, tariff_id: 2, kind: "package", starts_at: "2026-09-29T17:34:00Z", ends_at: "2026-09-29T18:34:00Z", price_snapshot: 150, amount: 150 },
        ],
      }),
      tariffName,
      Date.parse("2026-09-29T18:40:00Z"),
    );

    expect(rows.map((row) => row.title)).toEqual(["Выбор игры", "3 часа", "Продление: 1 час", "Переигрыш"]);
    expect(rows[1]).toMatchObject({ note: "до 23:34", amount: 400, tone: "cross" });
    expect(rows[3]).toMatchObject({ tone: "circle", amount: null });
  });

  it("marks a running open segment and shows its hourly rate", () => {
    const rows = sessionTimeline(
      session({
        segments: [{ id: 3, tariff_id: null, kind: "open", starts_at: "2026-09-29T17:50:00Z", ends_at: null, price_snapshot: 160, amount: null }],
      }),
      tariffName,
      Date.parse("2026-09-29T18:40:00Z"),
    );
    expect(rows[1]).toMatchObject({ title: "Открытое время", note: "160 сом/ч · идёт", tone: "triangle" });
  });

  it("shows a free session by its reason instead of segments", () => {
    const rows = sessionTimeline(session({ kind: "free", reason: "друзья владельца", grace_until: null }), tariffName, 0);
    expect(rows).toEqual([expect.objectContaining({ title: "Бесплатная", note: "«друзья владельца»", tone: "square" })]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/cardModel.test.ts tests/barLines.test.ts tests/sessionTimeline.test.ts`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement**

```ts
// web/src/features/hall/cardModel.ts
import type { Tone } from "@/components/ui/tone";
import type { CardStatus } from "./remainingTime";

export interface StatusVisual {
  tone: Tone;
  /** DualSense face-button shape; "" where the label alone is enough. */
  glyph: string;
  label: string;
  /** Floods the whole card: the states the operator must notice from two metres away. */
  loud: boolean;
}

export const STATUS_VISUALS: Record<CardStatus, StatusVisual> = {
  free: { tone: "idle", glyph: "", label: "Свободна", loud: false },
  maintenance: { tone: "idle", glyph: "", label: "Обслуживание", loud: false },
  package_running: { tone: "cross", glyph: "✕", label: "Пакет", loud: false },
  package_warn: { tone: "amber", glyph: "!", label: "Скоро конец", loud: true },
  package_overtime: { tone: "circle", glyph: "○", label: "Переигрыш", loud: true },
  open_running: { tone: "triangle", glyph: "△", label: "Открытое время", loud: false },
  free_session: { tone: "square", glyph: "□", label: "Бесплатная", loud: false },
  service_session: { tone: "muted", glyph: "", label: "Служебная", loud: false },
};

export const BLOCK_MS = 15 * 60_000;

/**
 * Fill (0–1) of each 15-minute block of the running package segment. Lit blocks are
 * time still ahead, draining from the right, so "three lit blocks" reads as "under 45
 * minutes" at a glance.
 */
export function packageBlocks(remainingMs: number, segmentMs: number): number[] {
  const count = Math.max(1, Math.round(segmentMs / BLOCK_MS));
  return Array.from({ length: count }, (_, index) =>
    Math.min(1, Math.max(0, (remainingMs - index * BLOCK_MS) / BLOCK_MS)),
  );
}

/** Columns follow the console count, never the screen width alone: 6 consoles → 3×2. */
export function hallColumns(count: number): number {
  if (count <= 3) return Math.max(1, count);
  if (count <= 6) return 3;
  if (count <= 8) return 4;
  return 5;
}
```

```ts
// web/src/features/hall/barLines.ts
import type { OrderResponse } from "@/lib/api";

export interface BarLine {
  productId: number;
  qty: number;
  total: number;
  /** The row "−" deletes. Each tap adds one qty-1 row and a correction removes a row (Stage 4). */
  removableOrderId: number;
}

/** One line per product, in the order products were first added. */
export function groupOrders(orders: OrderResponse[]): BarLine[] {
  const byProduct = new Map<number, OrderResponse[]>();
  for (const order of orders) {
    const rows = byProduct.get(order.product_id) ?? [];
    rows.push(order);
    byProduct.set(order.product_id, rows);
  }
  return [...byProduct.entries()].map(([productId, rows]) => {
    const newestFirst = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
    const removable = newestFirst.find((row) => row.qty === 1) ?? newestFirst[0];
    return {
      productId,
      qty: rows.reduce((sum, row) => sum + row.qty, 0),
      total: rows.reduce((sum, row) => sum + row.qty * row.unit_price, 0),
      removableOrderId: removable.id,
    };
  });
}

export function ordersTotal(orders: OrderResponse[]): number {
  return orders.reduce((sum, order) => sum + order.qty * order.unit_price, 0);
}

/** "кола 0,5 × 2, сэндвич" — what a debt is made of, without opening the session. */
export function summarizeOrders(orders: OrderResponse[], productName: (productId: number) => string): string {
  return groupOrders(orders)
    .map((line) => productName(line.productId).toLowerCase() + (line.qty > 1 ? ` × ${line.qty}` : ""))
    .join(", ");
}
```

```ts
// web/src/features/hall/sessionTimeline.ts
import type { Tone } from "@/components/ui/tone";
import type { SessionResponse } from "@/lib/api";
import { formatClock } from "@/lib/bishkek";
import { formatAmount } from "@/lib/format";

export interface TimelineRow {
  key: string;
  atMs: number;
  title: string;
  note: string;
  amount: number | null;
  tone: Tone;
}

/** The rows of the session details timeline: grace, every segment, and a running overtime. */
export function sessionTimeline(
  session: SessionResponse,
  tariffName: (tariffId: number | null) => string | undefined,
  nowMs: number,
): TimelineRow[] {
  const startedMs = Date.parse(session.started_at);

  if (session.kind !== "paid") {
    const free = session.kind === "free";
    return [
      {
        key: "kind",
        atMs: startedMs,
        title: free ? "Бесплатная" : "Служебная",
        note: session.reason ? `«${session.reason}»` : "",
        amount: null,
        tone: free ? "square" : "muted",
      },
    ];
  }

  const rows: TimelineRow[] = [];
  if (session.grace_until) {
    rows.push({ key: "grace", atMs: startedMs, title: "Выбор игры", note: "без оплаты", amount: null, tone: "idle" });
  }

  session.segments.forEach((segment, index) => {
    const name = tariffName(segment.tariff_id) ?? (segment.kind === "package" ? "Пакет" : "Открытое время");
    const note =
      segment.kind === "open"
        ? `${formatAmount(segment.price_snapshot)} сом/ч${segment.ends_at ? "" : " · идёт"}`
        : segment.ends_at
          ? `до ${formatClock(Date.parse(segment.ends_at))}`
          : "";
    rows.push({
      key: `segment-${segment.id}`,
      atMs: Date.parse(segment.starts_at),
      title: index === 0 ? name : `Продление: ${name}`,
      note,
      amount: segment.amount,
      tone: segment.kind === "open" ? "triangle" : "cross",
    });
  });

  const last = session.segments[session.segments.length - 1];
  if (last?.kind === "package" && last.ends_at && Date.parse(last.ends_at) <= nowMs) {
    rows.push({
      key: "overtime",
      atMs: Date.parse(last.ends_at),
      title: "Переигрыш",
      note: "не продлён",
      amount: null,
      tone: "circle",
    });
  }
  return rows;
}
```

- [ ] **Step 4: Run everything**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/hall/cardModel.ts web/src/features/hall/barLines.ts web/src/features/hall/sessionTimeline.ts web/tests
git commit -m "Add pure helpers for card visuals, bar lines and session timeline"
```

---

### Task 5: Session details sheet

A standalone component, wired into the hall in Task 7. It is what a click on a busy card opens: the timeline, the bill, and every action on the session, including stopping one that still owes money (the card itself shows «Принять N» there).

**Files:**
- Create: `web/src/features/hall/SessionSheet.tsx`
- Test: `web/tests/SessionSheet.test.tsx`

**Interfaces:**
- Consumes: `Sheet*`, `StateChip`, `Button` (Task 3); `STATUS_VISUALS` (Task 4); `sessionTimeline`, `ordersTotal`, `summarizeOrders` (Task 4); `computeCardTiming` (`remainingTime.ts`); `api.tariffs`.
- Produces: `SessionSheet(props: SessionSheetProps)`:

```ts
interface SessionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consoleView: HallConsoleResponse; // renders nothing when consoleView.session is null
  nowMs: number;
  warnMinutes: number;
  productName: (productId: number) => string;
  onPay: () => void;
  onExtend: () => void;
  onBar: () => void;
  onStop: () => void;
  stopping?: boolean;
}
```

- [ ] **Step 1: Write the failing test**

```tsx
// web/tests/SessionSheet.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionSheet } from "@/features/hall/SessionSheet";
import type { HallConsoleResponse } from "@/lib/api";

const NOW = Date.parse("2026-09-29T18:40:00Z");

function consoleWithDebt(): HallConsoleResponse {
  return {
    id: 2,
    zone_id: 1,
    name: "PS 2",
    is_active: true,
    charge_total: 390,
    paid_total: 150,
    balance: 240,
    session: {
      id: 12,
      console_id: 2,
      business_day_id: 1,
      kind: "paid",
      reason: null,
      status: "active",
      started_at: "2026-09-29T17:44:00Z",
      grace_until: "2026-09-29T17:47:00Z",
      ended_at: null,
      comment: null,
      segments: [
        { id: 1, tariff_id: 2, kind: "package", starts_at: "2026-09-29T17:44:00Z", ends_at: "2026-09-29T18:47:00Z", price_snapshot: 150, amount: 150 },
      ],
      orders: [
        { id: 1, session_id: 12, product_id: 1, qty: 1, unit_price: 60, created_at: "2026-09-29T18:00:00Z" },
        { id: 2, session_id: 12, product_id: 1, qty: 1, unit_price: 60, created_at: "2026-09-29T18:01:00Z" },
        { id: 3, session_id: 12, product_id: 2, qty: 1, unit_price: 120, created_at: "2026-09-29T18:02:00Z" },
      ],
      charge_total: 390,
      paid_total: 150,
      balance: 240,
    },
  };
}

function renderSheet(handlers: Partial<Record<"onPay" | "onExtend" | "onBar" | "onStop", () => void>> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => [{ id: 2, zone_id: 1, kind: "package", name: "1 час", duration_min: 60, price: 150, hourly_rate: null, is_active: true }] })),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SessionSheet
        open
        onOpenChange={() => {}}
        consoleView={consoleWithDebt()}
        nowMs={NOW}
        warnMinutes={5}
        productName={(id) => (id === 1 ? "Кола" : "Сэндвич")}
        onPay={handlers.onPay ?? vi.fn()}
        onExtend={handlers.onExtend ?? vi.fn()}
        onBar={handlers.onBar ?? vi.fn()}
        onStop={handlers.onStop ?? vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("SessionSheet", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the timeline, the bill and what the bar debt is made of", async () => {
    renderSheet();
    const sheet = screen.getByRole("dialog", { name: "PS 2" });

    expect(within(sheet).getByText("Выбор игры")).toBeInTheDocument();
    expect(await within(sheet).findByText("1 час")).toBeInTheDocument();
    expect(within(sheet).getByText("кола × 2, сэндвич")).toBeInTheDocument();
    expect(within(sheet).getByTestId("bill-due")).toHaveTextContent("240 сом");
  });

  it("offers payment and lets the operator stop a session that still owes money", () => {
    const onPay = vi.fn();
    const onStop = vi.fn();
    renderSheet({ onPay, onStop });

    fireEvent.click(screen.getByRole("button", { name: "Принять 240" }));
    fireEvent.click(screen.getByRole("button", { name: "Завершить сессию" }));
    expect(onPay).toHaveBeenCalled();
    expect(onStop).toHaveBeenCalled();
  });

  it("routes extend and bar to their own sheets", () => {
    const onExtend = vi.fn();
    const onBar = vi.fn();
    renderSheet({ onExtend, onBar });

    fireEvent.click(screen.getByRole("button", { name: "Продлить" }));
    fireEvent.click(screen.getByRole("button", { name: "Добавить из бара" }));
    expect(onExtend).toHaveBeenCalled();
    expect(onBar).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/SessionSheet.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```tsx
// web/src/features/hall/SessionSheet.tsx
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StateChip } from "@/components/ui/state-chip";
import { api, type HallConsoleResponse } from "@/lib/api";
import { formatClock } from "@/lib/bishkek";
import { formatAmount, formatSom } from "@/lib/format";
import { ordersTotal, summarizeOrders } from "./barLines";
import { STATUS_VISUALS } from "./cardModel";
import { computeCardTiming } from "./remainingTime";
import { sessionTimeline } from "./sessionTimeline";

interface SessionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consoleView: HallConsoleResponse;
  nowMs: number;
  warnMinutes: number;
  productName: (productId: number) => string;
  onPay: () => void;
  onExtend: () => void;
  onBar: () => void;
  onStop: () => void;
  stopping?: boolean;
}

export function SessionSheet({
  open,
  onOpenChange,
  consoleView,
  nowMs,
  warnMinutes,
  productName,
  onPay,
  onExtend,
  onBar,
  onStop,
  stopping = false,
}: SessionSheetProps) {
  const tariffsQuery = useQuery({ queryKey: ["tariffs"], queryFn: api.tariffs, enabled: open });
  const session = consoleView.session;
  if (!session) return null;

  const timing = computeCardTiming(consoleView, nowMs, warnMinutes);
  const visual = STATUS_VISUALS[timing.status];
  const tariffName = (id: number | null) => tariffsQuery.data?.find((tariff) => tariff.id === id)?.name;
  const rows = sessionTimeline(session, tariffName, nowMs);
  const bar = ordersTotal(session.orders);
  const lastSegment = session.segments[session.segments.length - 1];
  const canExtend = session.kind === "paid" && lastSegment?.kind === "package";
  const owes = timing.balance > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent tone={visual.tone}>
        <SheetHeader>
          <SheetTitle>{consoleView.name}</SheetTitle>
          <StateChip tone={visual.tone} glyph={visual.glyph} loud={visual.loud}>
            {visual.label}
          </StateChip>
        </SheetHeader>
        <SheetBody>
          <section>
            <h3 className="field-label">Отрезки</h3>
            <ol className="grid">
              {rows.map((row, index) => (
                <li key={row.key} data-tone={row.tone} className="relative grid grid-cols-[52px_14px_1fr_auto] items-start gap-2.5 pb-3.5">
                  <time className="num pt-px text-[13px] text-fg-muted">{formatClock(row.atMs)}</time>
                  <span aria-hidden className="mt-[5px] h-2.5 w-2.5 rounded-full bg-tone shadow-[0_0_8px_hsl(var(--c))]" />
                  {index < rows.length - 1 && <span aria-hidden className="absolute bottom-0.5 left-[66px] top-[18px] w-0.5 bg-line" />}
                  <span>
                    <b className="block font-medium">{row.title}</b>
                    {row.note && <span className="text-[13px] text-fg-muted">{row.note}</span>}
                  </span>
                  <span className="num">{row.amount === null ? "—" : formatAmount(row.amount)}</span>
                </li>
              ))}
            </ol>
          </section>

          {session.kind !== "service" && (
            <section>
              <h3 className="field-label">Счёт</h3>
              <dl className="rounded-xl border border-line bg-bg px-3.5 py-1.5">
                <BillRow label="Время" value={formatAmount(timing.chargeTotal - bar)} />
                <BillRow
                  label="Бар"
                  note={bar > 0 ? summarizeOrders(session.orders, productName) : undefined}
                  value={formatAmount(bar)}
                />
                <BillRow label="Оплачено" value={formatAmount(consoleView.paid_total)} />
                <div className="flex items-baseline justify-between py-2.5">
                  <dt className="text-[13.5px] text-fg-muted">К оплате</dt>
                  <dd data-testid="bill-due" className="num text-[26px] font-bold">
                    {formatSom(Math.max(0, timing.balance))}
                  </dd>
                </div>
              </dl>
              <Button variant="outline" className="mt-2 w-full" onClick={onBar}>
                Добавить из бара
              </Button>
            </section>
          )}

          {canExtend && (
            <Button variant="outline" onClick={onExtend}>
              Продлить
            </Button>
          )}
        </SheetBody>
        <SheetFooter>
          <Button variant={owes ? "outline" : "default"} onClick={onStop} disabled={stopping}>
            Завершить сессию
          </Button>
          {owes && <Button onClick={onPay}>Принять {formatAmount(timing.balance)}</Button>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function BillRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-line py-2.5">
      <dt className="text-[13.5px] text-fg-muted">
        {label}
        {note && <small className="block text-[11.5px] text-fg-faint">{note}</small>}
      </dt>
      <dd className="num text-base">{value}</dd>
    </div>
  );
}
```

- [ ] **Step 4: Run everything**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/hall/SessionSheet.tsx web/tests/SessionSheet.test.tsx
git commit -m "Add the session details sheet"
```

---

### Task 6: Hall shell — top bar with the till, theme switch, help, grid, tickets

**Files:**
- Create: `web/src/features/hall/TopBar.tsx`, `web/src/features/hall/Till.tsx`, `web/src/features/hall/HallHelp.tsx`, `web/src/features/theme/ThemeSwitch.tsx`
- Modify: `web/src/features/hall/HallPage.tsx` (layout, pills, grid, tickets; dialog logic unchanged)
- Test: `web/tests/HallPage.test.tsx` (helper and copy updates, two new tests)

**Interfaces:**
- Consumes: `hallColumns` (Task 4), `summarizeOrders` (Task 4), `useThemeMode` (Task 2), `formatClock` (Task 1), `computeCardTiming`, `api.currentBusinessDay`, `api.businessDaySummary`, `api.products`.
- Produces: `TopBar({ businessDayOpen, businessDayId, snapshotAt, nowMs, onCloseDay, onLogout })`, `Till({ businessDayId, snapshotAt })`, `ThemeSwitch()`, `HallHelp({ hotkeys?: boolean })`.
- Produces (HallPage): `productName(id)` (products query, fallback `Товар ${id}`), used by later tasks.

- [ ] **Step 1: Update the test harness and write the new tests**

In `web/tests/HallPage.test.tsx`:

1. Import the provider and wrap `renderHall`:

```tsx
import { ThemeModeProvider } from "@/features/theme/ThemeModeProvider";
// …
function renderHall() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeModeProvider>
        <HallPage />
      </ThemeModeProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}
```

2. The one test that renders `HallPage` without `renderHall` (the history test builds its own fetch mock but calls `renderHall()`, so nothing else to change).

3. Copy updates:

| Old | New |
|---|---|
| `await waitFor(() => expect(screen.getByText("Продажа без игры")).toBeInTheDocument());` (2×) | `await waitFor(() => expect(screen.getByRole("button", { name: "+ Продажа без игры" })).toBeInTheDocument());` |
| `getByRole("button", { name: "+ Продажа" })` (2×) | `getByRole("button", { name: "+ Продажа без игры" })` |
| `getByText(/Чек №9/)` (3×) | `getByText("№9")` |
| `getByRole("button", { name: "Оплатить" })` | `getByRole("button", { name: "Принять 150" })` |

4. New tests, inside `describe("HallPage", …)`:

```tsx
  it("shows the day's till with cash and non-cash apart", async () => {
    const fetchMock = stubApi(snapshot([freeConsole(1)]));
    const baseImpl = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/summary")) {
        return {
          ok: true,
          json: async () => ({
            opening_cash: 2000, cash_total: 3830, qr_total: 2150, transfer_total: 600, expected_cash: 5830,
            sessions_count: 23, minutes_total: 1900, bar_sales_total: 690, has_active_sessions: true,
          }),
        };
      }
      return baseImpl(url);
    });
    renderHall();

    const till = await screen.findByRole("region", { name: "Касса дня" });
    await waitFor(() => expect(within(till).getByText("5 830")).toBeInTheDocument());
    expect(within(till).getByText("2 150")).toBeInTheDocument();
    expect(within(till).getByText("600")).toBeInTheDocument();
    expect(within(till).getByText("23 сессии · 31 ч 40 мин · бар 690")).toBeInTheDocument();
  });

  it("counts consoles that need a decision", async () => {
    const overtime = paidConsole(1, 7, 0);
    overtime.session!.segments[0].ends_at = new Date(Date.now() - 60_000).toISOString();
    stubApi(snapshot([overtime, freeConsole(2)]));
    renderHall();

    await waitFor(() => expect(screen.getByText("ждут решения")).toBeInTheDocument());
    expect(screen.getByText("ждут решения").parentElement).toHaveTextContent("1 ждут решения");
    expect(screen.getByText("заняты").parentElement).toHaveTextContent("1 из 2 заняты");
  });
```

Add `within` to the `@testing-library/react` import.

- [ ] **Step 2: Run the hall tests to verify they fail**

Run: `npm test -- tests/HallPage.test.tsx`
Expected: FAIL — no till region, old walk-in copy.

- [ ] **Step 3: Implement the shell components**

```tsx
// web/src/features/theme/ThemeSwitch.tsx
import { useRef } from "react";
import { Moon, Sun, SunMoon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useThemeMode } from "./themeContext";

const OPTIONS: { mode: ThemeMode; title: string; hint: string }[] = [
  { mode: "auto", title: "По времени суток", hint: "днём светлая, с 19:00 до 09:00 тёмная" },
  { mode: "light", title: "Светлая", hint: "для работы днём" },
  { mode: "dark", title: "Тёмная", hint: "для вечера и ночи" },
];

export function ThemeSwitch() {
  const { mode, setMode } = useThemeMode();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : SunMoon;

  return (
    <details ref={detailsRef} className="relative">
      <summary
        aria-label="Тема оформления"
        className={cn(buttonVariants({ variant: "outline", size: "icon" }), "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}
      >
        <Icon />
      </summary>
      <div
        role="group"
        aria-label="Тема оформления"
        className="absolute right-0 top-[calc(100%+8px)] z-30 grid w-[280px] gap-1 rounded-xl border border-hover-line bg-surface-2 p-1.5 shadow-[var(--shadow-lg)]"
      >
        {OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            aria-pressed={mode === option.mode}
            onClick={() => {
              setMode(option.mode);
              detailsRef.current?.removeAttribute("open");
            }}
            className="grid gap-px rounded-lg px-2.5 py-2 text-left hover:bg-hover aria-pressed:bg-surface aria-pressed:ring-1 aria-pressed:ring-hover-line"
          >
            <b className="text-sm font-semibold">{option.title}</b>
            <span className="text-[12.5px] text-fg-muted">{option.hint}</span>
          </button>
        ))}
      </div>
    </details>
  );
}
```

```tsx
// web/src/features/hall/Till.tsx
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatAmount, formatHoursMinutes, pluralRu } from "@/lib/format";
import { cn } from "@/lib/utils";

interface TillProps {
  businessDayId: number;
  /** The hall snapshot's generated_at: any hall change (a payment is one) refreshes the till. */
  snapshotAt: string | undefined;
}

export function Till({ businessDayId, snapshotAt }: TillProps) {
  const { data } = useQuery({
    queryKey: ["business-day-summary", businessDayId, "till", snapshotAt],
    queryFn: () => api.businessDaySummary(businessDayId),
    placeholderData: keepPreviousData,
  });
  if (!data || typeof data.expected_cash !== "number") return null;

  const sessions = `${data.sessions_count} ${pluralRu(data.sessions_count, ["сессия", "сессии", "сессий"])}`;

  // Cash and non-cash are always shown apart (CLAUDE.md rule 10): cash is counted, QR and
  // transfers are checked against the bank app.
  return (
    <section
      aria-label="Касса дня"
      className="order-last grid w-full grid-cols-3 rounded-xl border border-line bg-surface min-[1281px]:order-none min-[1281px]:flex min-[1281px]:w-auto"
    >
      <TillItem label="Наличные в кассе" value={formatAmount(data.expected_cash)} big />
      <TillItem label="QR" value={formatAmount(data.qr_total)} />
      <TillItem label="Перевод" value={formatAmount(data.transfer_total)} />
      <div className="col-span-3 grid content-center border-t border-line px-4 py-1.5 min-[1281px]:border-l min-[1281px]:border-t-0">
        <span className="text-[11px] text-fg-muted">За день</span>
        <span className="text-[13px] font-medium">
          {sessions} · {formatHoursMinutes(data.minutes_total)} · бар {formatAmount(data.bar_sales_total)}
        </span>
      </div>
    </section>
  );
}

function TillItem({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="grid min-w-0 content-center border-l border-line px-4 py-1.5 first:border-l-0">
      <span className="text-[11px] leading-tight text-fg-muted">{label}</span>
      <span className="leading-tight">
        <span className={cn("num font-bold", big ? "text-2xl max-sm:text-lg" : "text-lg max-sm:text-base")}>{value}</span>
        <span className="ml-1 text-[11px] text-fg-muted">сом</span>
      </span>
    </div>
  );
}
```

```tsx
// web/src/features/hall/TopBar.tsx
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ThemeSwitch } from "@/features/theme/ThemeSwitch";
import { api } from "@/lib/api";
import { formatClock } from "@/lib/bishkek";
import { formatHoursMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Till } from "./Till";

interface TopBarProps {
  businessDayOpen: boolean;
  businessDayId: number | null;
  snapshotAt: string | undefined;
  nowMs: number;
  onCloseDay: () => void;
  onLogout: () => void;
}

export function TopBar({ businessDayOpen, businessDayId, snapshotAt, nowMs, onCloseDay, onLogout }: TopBarProps) {
  const dayQuery = useQuery({
    queryKey: ["business-day", "current"],
    queryFn: api.currentBusinessDay,
    enabled: businessDayOpen,
  });
  const openedAt = typeof dayQuery.data?.opened_at === "string" ? Date.parse(dayQuery.data.opened_at) : null;

  let dayLine = "День не открыт";
  if (businessDayOpen) {
    dayLine = openedAt
      ? `День открыт с ${formatClock(openedAt)} · идёт ${formatHoursMinutes(Math.max(0, Math.floor((nowMs - openedAt) / 60_000)))}`
      : "День открыт";
  }

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-5 gap-y-2.5 border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur short:py-2 sm:px-6">
      <div className="grid gap-0.5">
        <div className="font-display text-base font-extrabold tracking-wide">
          PS<span className="font-medium text-fg-muted">·клуб</span>
        </div>
        <div className="flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-fg-muted">
          <span
            aria-hidden
            className={cn(
              "h-[7px] w-[7px] rounded-full",
              businessDayOpen ? "bg-status-triangle shadow-[0_0_8px_hsl(var(--triangle))]" : "bg-status-idle",
            )}
          />
          {dayLine}
        </div>
      </div>
      {businessDayOpen && businessDayId !== null && <Till businessDayId={businessDayId} snapshotAt={snapshotAt} />}
      <div className="hidden flex-1 sm:block" />
      <div className="whitespace-nowrap font-display text-[26px] font-extrabold tracking-tight">
        {formatClock(nowMs)}
        <small className="ml-1.5 font-sans text-[11px] font-normal tracking-normal text-fg-muted">Бишкек</small>
      </div>
      <ThemeSwitch />
      {businessDayOpen && (
        <Button variant="outline" onClick={onCloseDay}>
          Закрыть день
        </Button>
      )}
      <Button variant="ghost" onClick={onLogout}>
        Выйти
      </Button>
    </header>
  );
}
```

```tsx
// web/src/features/hall/HallHelp.tsx
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LEGEND: { glyph: string; tone: string; text: string }[] = [
  { glyph: "✕", tone: "text-status-cross", text: "Пакет" },
  { glyph: "△", tone: "text-status-triangle", text: "Открытое время" },
  { glyph: "!", tone: "text-status-amber-text", text: "Скоро конец — последние минуты пакета" },
  { glyph: "○", tone: "text-status-circle", text: "Переигрыш — время пакета вышло" },
  { glyph: "□", tone: "text-status-square", text: "Бесплатная" },
];

/** Legend in a popover: learned in a day, so it should not take room on the hall. */
export function HallHelp({ hotkeys = false }: { hotkeys?: boolean }) {
  return (
    <details className="relative max-sm:hidden">
      <summary
        aria-label="Обозначения"
        className={cn(buttonVariants({ variant: "outline", size: "icon" }), "cursor-pointer list-none font-bold [&::-webkit-details-marker]:hidden")}
      >
        ?
      </summary>
      <div className="absolute right-0 top-[calc(100%+8px)] z-30 grid w-[280px] gap-2 rounded-xl border border-hover-line bg-surface-2 px-4 py-3.5 text-[13px] text-fg-muted shadow-[var(--shadow-lg)]">
        {LEGEND.map((item) => (
          <span key={item.text} className="flex items-center gap-2">
            <span aria-hidden className={cn("grid w-4 place-items-center text-xs font-bold", item.tone)}>
              {item.glyph}
            </span>
            {item.text}
          </span>
        ))}
        <span className="flex items-center gap-2">
          <span aria-hidden className="flex w-4 gap-0.5">
            <i className="h-2 flex-1 rounded-[1px] bg-status-cross" />
            <i className="h-2 flex-1 rounded-[1px] bg-status-cross" />
          </span>
          Блок — 15 минут, горят оставшиеся
        </span>
        {hotkeys && (
          <>
            <hr className="border-line" />
            <span>
              <Kbd>1</Kbd>–<Kbd>9</Kbd> открыть консоль
            </span>
            <span>
              <Kbd>Esc</Kbd> закрыть панель
            </span>
          </>
        )}
      </div>
    </details>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-[5px] border border-b-2 border-line bg-bg px-1 text-[11px] font-semibold text-fg-faint">
      {children}
    </kbd>
  );
}
```

- [ ] **Step 4: Rewrite the HallPage layout**

Replace the JSX `return (…)` block of `HallPage` and add the new queries and derived values. The `DialogState` type, `findSession`, `runSessionAction`, `finishSession`, `openTicketMutation` and all dialog renders below the grid stay exactly as they are.

Add these imports (keep the existing ones; `formatSom` becomes unused — remove it):

```tsx
import { type CSSProperties } from "react";
import { capitalize, formatAmount } from "@/lib/format";
import { HallHelp } from "./HallHelp";
import { TopBar } from "./TopBar";
import { summarizeOrders } from "./barLines";
import { hallColumns } from "./cardModel";
import { computeCardTiming } from "./remainingTime";
```

After `const tickets = hall?.tickets ?? [];` add:

```tsx
  const productsQuery = useQuery({ queryKey: ["products"], queryFn: api.products });
  const productName = (productId: number) =>
    productsQuery.data?.find((product) => product.id === productId)?.name ?? `Товар ${productId}`;
  const statuses = consoles.map((c) => computeCardTiming(c, nowMs, warnMinutes).status);
  const busyCount = consoles.filter((c) => c.session !== null).length;
  const alertCount = statuses.filter((s) => s === "package_warn" || s === "package_overtime").length;
```

Replace the return block's top part (everything from `<div data-testid="hall-page" …>` down to, but not including, `{dialog.kind === "start" && (`) with:

```tsx
    <div data-testid="hall-page" className="min-h-screen">
      <TopBar
        businessDayOpen={hall?.business_day_open ?? false}
        businessDayId={hall?.business_day_id ?? null}
        snapshotAt={hall?.generated_at}
        nowMs={nowMs}
        onCloseDay={() => setDialog({ kind: "close-day" })}
        onLogout={() => logout().catch(() => {})}
      />

      <main className="px-4 pb-10 pt-[18px] short:pt-2.5 sm:px-6">
        <div className="mb-4 flex flex-wrap items-center gap-3 short:mb-2.5">
          <h1 className="mr-1 font-display text-[26px] font-extrabold tracking-tight">Зал</h1>
          {hall?.business_day_open && (
            <>
              <span className="inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-3 text-[13px] text-fg-muted">
                <b className="font-semibold text-fg">
                  {busyCount} из {consoles.length}
                </b>{" "}
                <span>заняты</span>
              </span>
              {alertCount > 0 && (
                <span className="inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-full border border-status-circle/50 bg-status-circle/10 px-3 text-[13px] text-fg">
                  <b className="font-semibold text-status-circle">{alertCount}</b>{" "}
                  <span>ждут решения</span>
                </span>
              )}
              <div className="ml-auto flex flex-wrap gap-2 max-sm:ml-0 max-sm:w-full max-sm:[&>button]:flex-1">
                <Button variant="outline" onClick={() => runSessionAction(() => openTicketMutation.mutateAsync())}>
                  + Продажа без игры
                </Button>
                <Button variant="ghost" onClick={() => setDialog({ kind: "history" })}>
                  История дней
                </Button>
                <HallHelp />
              </div>
            </>
          )}
        </div>

        {actionError && (
          <p role="alert" className="mb-4 text-sm text-status-circle">
            {actionError}
          </p>
        )}

        {hall === undefined ? (
          <div>Загрузка…</div>
        ) : (
          <BusinessDayGuard businessDayOpen={hall.business_day_open}>
            <section
              aria-label="Консоли"
              className="grid grid-cols-1 gap-4 md:grid-cols-2 min-[1101px]:grid-cols-[repeat(var(--cols),minmax(0,1fr))]"
              style={{ "--cols": hallColumns(consoles.length) } as CSSProperties}
            >
              {consoles.map((consoleView) => {
                const session = consoleView.session;
                return (
                  <ConsoleCard
                    key={consoleView.id}
                    console={consoleView}
                    nowMs={nowMs}
                    warnMinutes={warnMinutes}
                    onStart={() => setDialog({ kind: "start", consoleId: consoleView.id })}
                    onExtend={() => session && setDialog({ kind: "extend", sessionId: session.id })}
                    onStop={() => session && finishSession(session.id)}
                    onCancel={() =>
                      session &&
                      runSessionAction(async () => {
                        const cancelled = await cancel(session.id);
                        if (cancelled.balance > 0) {
                          setDialog({ kind: "settle", sessionId: cancelled.id, balance: cancelled.balance });
                        }
                      })
                    }
                    onPay={() => session && setDialog({ kind: "pay", sessionId: session.id })}
                    onBar={() => session && setDialog({ kind: "bar", sessionId: session.id })}
                  />
                );
              })}
            </section>

            {tickets.length > 0 && (
              <section className="mt-7">
                <h2 className="field-label">Чеки без игры</h2>
                <div className="grid gap-2">
                  {tickets.map((t) => (
                    <div
                      key={t.id}
                      className="flex flex-wrap items-center gap-3.5 rounded-xl border border-line bg-surface px-3.5 py-3"
                    >
                      <span className="num text-fg-muted">№{t.id}</span>
                      <span className="min-w-0 flex-1 text-sm text-fg-muted max-sm:basis-3/5">
                        {t.orders.length > 0 ? (
                          <b className="font-medium text-fg">{capitalize(summarizeOrders(t.orders, productName))}</b>
                        ) : (
                          "пока пусто"
                        )}
                      </span>
                      <span className="num">
                        {formatAmount(t.charge_total)}
                        <span className="ml-1 font-sans text-[11px] text-fg-muted">сом</span>
                      </span>
                      <Button variant="outline" onClick={() => setDialog({ kind: "bar", sessionId: t.id })}>
                        Бар
                      </Button>
                      {t.balance > 0 ? (
                        <Button onClick={() => setDialog({ kind: "pay", sessionId: t.id })}>
                          Принять {formatAmount(t.balance)}
                        </Button>
                      ) : (
                        <Button onClick={() => runSessionAction(() => stop(t.id))}>Завершить</Button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </BusinessDayGuard>
        )}
      </main>
```

(The existing dialog renders follow unchanged, then the closing `</div>`.)

- [ ] **Step 5: Run everything**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/features web/tests/HallPage.test.tsx
git commit -m "Redesign the hall shell with the till in the top bar"
```

---

### Task 7: Console card redesign, card-to-details wiring, hotkeys

**Files:**
- Modify: `web/src/index.css` (card styles, appended to `@layer components`)
- Modify: `web/src/features/hall/ConsoleCard.tsx` (rewrite)
- Create: `web/src/features/hall/useHallHotkeys.ts`
- Modify: `web/src/features/hall/HallPage.tsx` (details state, card props, hotkeys, `HallHelp hotkeys`)
- Test: `web/tests/ConsoleCard.test.tsx` (new), `web/tests/useHallHotkeys.test.tsx` (new), `web/tests/HallPage.test.tsx` (copy updates, one new test)

**Interfaces:**
- Consumes: `STATUS_VISUALS`, `packageBlocks` (Task 4); `ordersTotal`, `summarizeOrders` (Task 4); `StateChip`, `Button variant="state"` (Task 3); `SessionSheet` (Task 5); `formatClock` (Task 1).
- Produces: `ConsoleCard` props: `{ console, nowMs, warnMinutes, hotkey?: number, productName, onOpen, onStart, onExtend, onStop, onCancel, onPay, onBar }`.
- Produces: `useHallHotkeys(consoles: HallConsoleResponse[], onOpen: (consoleView: HallConsoleResponse) => void, enabled: boolean): void` — keys 1–9 open the n-th console; ignored while typing, with modifiers, or while any `[role="dialog"]` is open.
- Produces (HallPage): `DialogState` gains `{ kind: "details"; consoleId: number }`.

**Card actions (exact copy):**

| Status | Buttons (left → right) |
|---|---|
| free | `Начать сессию` (state, tone cross, full width) |
| maintenance | — |
| package_running | `Продлить` · `Бар` · balance > 0 ? `Принять {N}` (state) : `Стоп` |
| package_warn | `Продлить` (state) · `Бар` · balance > 0 ? `Оплата` : `Стоп` |
| package_overtime | `Продлить` (default) · `Завершить` |
| open_running | `Бар` · `Рассчитать · {N}` (state, stops then settles) |
| free_session | `Бар` · `Завершить` (state) |
| service_session | `Завершить` (state) |

During grace, the strip shows `Выбор игры · mm:ss` with the link button `Отменить без оплаты`. In overtime, the strip reads `Выключите ТВ на {name}, если гости ушли` (the phase 1 manual plug driver). Otherwise, while balance > 0 and bar > 0, the strip reads `Не оплачен бар: {summary}` with the amount.

- [ ] **Step 1: Write the failing tests**

```tsx
// web/tests/ConsoleCard.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConsoleCard } from "@/features/hall/ConsoleCard";
import type { HallConsoleResponse } from "@/lib/api";

const NOW = Date.parse("2026-09-29T18:40:00Z"); // 00:40 in Bishkek

function busy(overrides: { balance?: number; endsInMs?: number; graceLeftMs?: number; withBar?: boolean } = {}): HallConsoleResponse {
  const { balance = 0, endsInMs = 60 * 60_000, graceLeftMs = -60_000, withBar = false } = overrides;
  const orders = withBar
    ? [
        { id: 1, session_id: 7, product_id: 1, qty: 1, unit_price: 60, created_at: "2026-09-29T18:00:00Z" },
        { id: 2, session_id: 7, product_id: 1, qty: 1, unit_price: 60, created_at: "2026-09-29T18:01:00Z" },
      ]
    : [];
  const charge = 300 + orders.length * 60;
  return {
    id: 1,
    zone_id: 1,
    name: "PS5-1",
    is_active: true,
    charge_total: charge,
    paid_total: charge - balance,
    balance,
    session: {
      id: 7,
      console_id: 1,
      business_day_id: 1,
      kind: "paid",
      reason: null,
      status: "active",
      started_at: new Date(NOW - 20 * 60_000).toISOString(),
      grace_until: new Date(NOW + graceLeftMs).toISOString(),
      ended_at: null,
      comment: null,
      segments: [
        {
          id: 1,
          tariff_id: 1,
          kind: "package",
          starts_at: new Date(NOW - 20 * 60_000).toISOString(),
          ends_at: new Date(NOW + endsInMs).toISOString(),
          price_snapshot: 300,
          amount: 300,
        },
      ],
      orders,
      charge_total: charge,
      paid_total: charge - balance,
      balance,
    },
  };
}

const FREE: HallConsoleResponse = { id: 2, zone_id: 1, name: "PS5-2", is_active: true, session: null, charge_total: 0, paid_total: 0, balance: 0 };

function renderCard(consoleView: HallConsoleResponse) {
  const handlers = {
    onOpen: vi.fn(), onStart: vi.fn(), onExtend: vi.fn(), onStop: vi.fn(),
    onCancel: vi.fn(), onPay: vi.fn(), onBar: vi.fn(),
  };
  render(
    <ConsoleCard console={consoleView} nowMs={NOW} warnMinutes={5} hotkey={1} productName={() => "Кола"} {...handlers} />,
  );
  return handlers;
}

describe("ConsoleCard", () => {
  it("offers one big start button on a free console, and names it once", () => {
    const handlers = renderCard(FREE);
    expect(screen.getAllByText("Свободна")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Начать сессию" }));
    expect(handlers.onStart).toHaveBeenCalled();
    expect(handlers.onOpen).not.toHaveBeenCalled();
  });

  it("puts the money due on the primary button and keeps the click off the card", () => {
    const handlers = renderCard(busy({ balance: 300 }));
    expect(screen.getByText("1:00:00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Принять 300" }));
    expect(handlers.onPay).toHaveBeenCalled();
    expect(handlers.onOpen).not.toHaveBeenCalled();
  });

  it("opens the details when the card itself is clicked", () => {
    const handlers = renderCard(busy());
    fireEvent.click(screen.getByRole("article", { name: "PS5-1" }));
    expect(handlers.onOpen).toHaveBeenCalled();
  });

  it("cancels for free during the grace period", () => {
    const handlers = renderCard(busy({ graceLeftMs: 90_000 }));
    expect(screen.getByText("01:30")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отменить без оплаты" }));
    expect(handlers.onCancel).toHaveBeenCalled();
  });

  it("shows overtime loudly with the manual TV reminder", () => {
    renderCard(busy({ endsInMs: -6 * 60_000 - 15_000 }));
    const card = screen.getByRole("article", { name: "PS5-1" });
    expect(card).toHaveAttribute("data-status", "package_overtime");
    expect(screen.getByText("+06:15")).toBeInTheDocument();
    expect(screen.getByText(/Выключите ТВ на/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Продлить" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Завершить" })).toBeInTheDocument();
  });

  it("says what an unpaid bar tab is made of", () => {
    renderCard(busy({ balance: 120, withBar: true }));
    expect(screen.getByText("Не оплачен бар: кола × 2")).toBeInTheDocument();
  });
});
```

```tsx
// web/tests/useHallHotkeys.test.tsx
import { fireEvent, render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHallHotkeys } from "@/features/hall/useHallHotkeys";
import type { HallConsoleResponse } from "@/lib/api";

const consoles = [1, 2, 3].map(
  (id): HallConsoleResponse => ({ id, zone_id: 1, name: `PS ${id}`, is_active: true, session: null, charge_total: 0, paid_total: 0, balance: 0 }),
);

describe("useHallHotkeys", () => {
  it("opens the n-th console on a digit key", () => {
    const onOpen = vi.fn();
    renderHook(() => useHallHotkeys(consoles, onOpen, true));
    fireEvent.keyDown(window, { key: "2" });
    expect(onOpen).toHaveBeenCalledWith(consoles[1]);
  });

  it("ignores digits typed into a field, with modifiers, beyond the list, or while a panel is open", () => {
    const onOpen = vi.fn();
    renderHook(() => useHallHotkeys(consoles, onOpen, true));
    const { getByRole, unmount } = render(<input aria-label="Сумма" />);
    fireEvent.keyDown(getByRole("textbox"), { key: "1" });
    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    fireEvent.keyDown(window, { key: "7" });
    unmount();

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    fireEvent.keyDown(window, { key: "1" });
    dialog.remove();

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("does nothing while disabled", () => {
    const onOpen = vi.fn();
    renderHook(() => useHallHotkeys(consoles, onOpen, false));
    fireEvent.keyDown(window, { key: "1" });
    expect(onOpen).not.toHaveBeenCalled();
  });
});
```

`web/tests/HallPage.test.tsx` updates:

| Old | New |
|---|---|
| `fireEvent.click(screen.getAllByRole("button", { name: "Старт" })[1]);` | `fireEvent.click(screen.getAllByRole("button", { name: "Начать сессию" })[1]);` |
| `await waitFor(() => expect(screen.getByText("Начать сессию")).toBeInTheDocument());` | `await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());` |
| `getByRole("button", { name: "Оплата" })` on `paidConsole(1, 7, 300)` (2×) | `getByRole("button", { name: "Принять 300" })` |
| `getByRole("button", { name: "Отменить" })` | `getByRole("button", { name: "Отменить без оплаты" })` |

Any test that clicks `Стоп` on a console whose fixture balance is > 0 (for example `paidConsole(1, 7, 300)` in the settle-after-stop tests) must now stop through the details sheet, because that card shows `Принять 300` instead of `Стоп`:

```tsx
fireEvent.click(screen.getByRole("article", { name: "PS5-1" }));
fireEvent.click(await screen.findByRole("button", { name: "Завершить сессию" }));
```

Tests using `paidConsole(1, 7, 0)` keep clicking `Стоп`.

New test in `describe("HallPage", …)`:

```tsx
  it("opens the session details when a busy card is clicked", async () => {
    stubApi(snapshot([paidConsole(1, 7, 300)]));
    renderHall();

    await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("article", { name: "PS5-1" }));
    const sheet = await screen.findByRole("dialog", { name: "PS5-1" });
    expect(within(sheet).getByText("Отрезки")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Принять 300" }));
    await waitFor(() => expect(screen.getByText("Оплата — остаток 300 сом")).toBeInTheDocument());
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/ConsoleCard.test.tsx tests/useHallHotkeys.test.tsx tests/HallPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Card styles**

Append inside `@layer components { … }` in `web/src/index.css`:

```css
  .console-card {
    @apply relative flex min-h-[300px] cursor-pointer flex-col overflow-hidden rounded-2xl border border-line p-5 pt-[22px] transition-colors hover:border-hover-line short:min-h-0 short:p-4;
    container-type: inline-size;
    background:
      radial-gradient(120% 70% at 50% -10%, hsl(var(--c) / 0.14), transparent 60%),
      hsl(var(--surface));
  }
  /* The loud states flood the whole card so they read from two metres away. */
  .console-card[data-status="package_warn"] {
    background: color-mix(in srgb, hsl(var(--c)) 9%, hsl(var(--surface)));
    border-color: hsl(var(--c) / 0.65);
  }
  .console-card[data-status="package_overtime"] {
    background: color-mix(in srgb, hsl(var(--c)) 13%, hsl(var(--surface)));
    border-color: hsl(var(--c));
    box-shadow: inset 0 0 0 1px hsl(var(--c)), 0 0 40px -12px hsl(var(--c));
  }
  /* The DualSense light bar. */
  .light-bar {
    @apply absolute left-[18%] right-[18%] top-0 h-1 rounded-b;
    background: hsl(var(--c));
    box-shadow: 0 0 14px 1px hsl(var(--c)), 0 0 42px 4px hsl(var(--c) / 0.45);
  }
  [data-theme="light"] .light-bar {
    box-shadow: 0 2px 10px hsl(var(--c) / 0.45);
  }
  .console-card[data-status="free"] .light-bar,
  .console-card[data-status="maintenance"] .light-bar {
    box-shadow: none;
  }
  .console-card[data-status="package_warn"] .light-bar,
  .console-card[data-status="package_overtime"] .light-bar {
    @apply inset-x-0 rounded-none;
  }
  .console-card[data-status="package_warn"] .light-bar {
    @apply animate-breathe;
  }
  .console-card[data-status="package_overtime"] .light-bar {
    @apply animate-breathe-fast;
  }
  .card-timer {
    @apply mb-1.5 mt-5 font-mono font-extrabold leading-none tracking-[-0.03em] short:mt-2.5;
    font-size: clamp(48px, 17cqi, 104px);
    font-variant-numeric: tabular-nums;
  }
  .console-card[data-status="package_warn"] .card-timer {
    color: hsl(var(--amber-text));
  }
  .console-card[data-status="package_overtime"] .card-timer {
    color: hsl(var(--circle));
  }
  .card-timer-idle {
    @apply mb-1.5 mt-7 font-display font-semibold text-fg-faint;
    font-size: clamp(28px, 7cqi, 40px);
  }
  .blocks > i {
    flex: 1;
    border-radius: 2px;
    background: linear-gradient(90deg, hsl(var(--c)) calc(var(--f) * 100%), hsl(var(--line)) 0);
  }
  .blocks-flow {
    background: repeating-linear-gradient(90deg, hsl(var(--c)) 0 10px, transparent 10px 16px);
    background-size: 16px 4px;
    opacity: 0.6;
  }
```

And after that layer (outside it), the short-screen timer size:

```css
@media (max-height: 820px) and (min-width: 1101px) {
  .card-timer {
    font-size: clamp(44px, 13cqi, 80px);
  }
}
```

- [ ] **Step 4: Rewrite `ConsoleCard.tsx`**

```tsx
// web/src/features/hall/ConsoleCard.tsx
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { StateChip } from "@/components/ui/state-chip";
import type { HallConsoleResponse, SegmentResponse, SessionResponse } from "@/lib/api";
import { formatClock } from "@/lib/bishkek";
import { formatAmount, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ordersTotal, summarizeOrders } from "./barLines";
import { STATUS_VISUALS, packageBlocks } from "./cardModel";
import { computeCardTiming, type CardTiming } from "./remainingTime";
import { useAlertSound } from "./useAlertSound";

interface ConsoleCardProps {
  console: HallConsoleResponse;
  nowMs: number;
  warnMinutes: number;
  hotkey?: number;
  productName: (productId: number) => string;
  onOpen: () => void;
  onStart: () => void;
  onExtend: () => void;
  onStop: () => void;
  onCancel: () => void;
  onPay: () => void;
  onBar: () => void;
}

export function ConsoleCard(props: ConsoleCardProps) {
  const { console: consoleView, nowMs, warnMinutes, hotkey, productName, onOpen } = props;
  const timing = computeCardTiming(consoleView, nowMs, warnMinutes);
  useAlertSound(timing.status);

  const visual = STATUS_VISUALS[timing.status];
  const session = consoleView.session;
  const lastSegment = session?.segments[session.segments.length - 1];
  const idle = timing.status === "free" || timing.status === "maintenance";

  // Buttons sit inside the clickable card: keep their clicks from also opening the details.
  const act = (handler: () => void) => (event: MouseEvent) => {
    event.stopPropagation();
    handler();
  };
  const openOnEnter = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" && event.target === event.currentTarget) onOpen();
  };

  return (
    <article
      aria-label={consoleView.name}
      data-tone={visual.tone}
      data-status={timing.status}
      tabIndex={0}
      className="console-card"
      onClick={onOpen}
      onKeyDown={openOnEnter}
    >
      <span aria-hidden className="light-bar" />
      <div className="flex items-center gap-2">
        <span className="font-display text-xl font-extrabold tracking-tight">{consoleView.name}</span>
        {hotkey !== undefined && (
          <kbd className="hidden h-5 min-w-5 place-items-center rounded-[5px] border border-b-2 border-line bg-bg px-1 text-[11px] font-semibold text-fg-faint sm:inline-grid">
            {hotkey}
          </kbd>
        )}
        {!idle && (
          <StateChip tone={visual.tone} glyph={visual.glyph} loud={visual.loud} className="ml-auto">
            {visual.label}
          </StateChip>
        )}
      </div>

      {idle ? (
        <div className="card-timer-idle">{visual.label}</div>
      ) : (
        <div className="card-timer">{timerText(timing, session, nowMs)}</div>
      )}
      <div className="min-h-[19px] text-[13px] text-fg-muted [&_b]:font-medium [&_b]:text-fg">
        {caption(timing, session, lastSegment)}
      </div>

      <Blocks timing={timing} lastSegment={lastSegment} />
      <CardStrip {...props} timing={timing} act={act} />
      <CardBill timing={timing} consoleView={consoleView} />

      <div className="mt-auto flex gap-2 [&>button]:min-w-0 [&>button]:flex-1">
        <CardActions timing={timing} act={act} {...props} />
      </div>
    </article>
  );
}

function timerText(timing: CardTiming, session: SessionResponse | null, nowMs: number): string {
  switch (timing.status) {
    case "package_running":
    case "package_warn":
      return formatDuration(timing.remainingMs ?? 0);
    case "package_overtime":
      return `+${formatDuration(timing.overtimeMs ?? 0)}`;
    case "open_running":
      return formatDuration(timing.elapsedMs ?? 0);
    default:
      return formatDuration(session ? nowMs - Date.parse(session.started_at) : 0);
  }
}

function caption(timing: CardTiming, session: SessionResponse | null, last: SegmentResponse | undefined): ReactNode {
  if (!session) return null;
  const since = formatClock(Date.parse(session.started_at));
  switch (timing.status) {
    case "package_running":
    case "package_warn":
      return last?.ends_at ? (
        <>
          осталось · до <b>{formatClock(Date.parse(last.ends_at))}</b>
        </>
      ) : null;
    case "package_overtime":
      return last?.ends_at ? (
        <>
          время вышло в <b>{formatClock(Date.parse(last.ends_at))}</b>
        </>
      ) : null;
    case "open_running":
      return (
        <>
          идёт с {since} · <b>{formatAmount(last?.price_snapshot ?? 0)} сом/ч</b>, поминутно
        </>
      );
    case "free_session":
      return (
        <>
          идёт с {since}
          {session.reason && (
            <>
              {" "}
              · причина: <b>{session.reason}</b>
            </>
          )}
        </>
      );
    case "service_session":
      return <>идёт с {since} · служебная</>;
    default:
      return null;
  }
}

function Blocks({ timing, lastSegment }: { timing: CardTiming; lastSegment: SegmentResponse | undefined }) {
  const running = timing.status === "package_running" || timing.status === "package_warn";
  if ((running || timing.status === "package_overtime") && lastSegment?.ends_at) {
    const segmentMs = Date.parse(lastSegment.ends_at) - Date.parse(lastSegment.starts_at);
    const fills = running
      ? packageBlocks(timing.remainingMs ?? 0, segmentMs)
      : packageBlocks(segmentMs, segmentMs); // overtime: every block lit, pulsing
    return (
      <div
        aria-hidden
        className={cn("blocks my-4 flex h-2 gap-[3px] short:my-2.5", timing.status === "package_overtime" && "animate-breathe-fast")}
      >
        {fills.map((fill, index) => (
          <i key={index} style={{ "--f": fill } as CSSProperties} />
        ))}
      </div>
    );
  }
  if (timing.status === "open_running") {
    return <div aria-hidden className="blocks-flow my-[18px] h-1 animate-flow short:my-3" />;
  }
  return <div aria-hidden className="my-4 h-2 short:my-2.5" />;
}

type Act = (handler: () => void) => (event: MouseEvent) => void;

function CardStrip({
  console: consoleView,
  nowMs,
  productName,
  onCancel,
  timing,
  act,
}: ConsoleCardProps & { timing: CardTiming; act: Act }) {
  const session = consoleView.session;
  if (!session) return null;
  const base = "-mt-0.5 mb-3 flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-[13px] short:mb-2 short:py-1.5";

  if (timing.status === "package_overtime") {
    return (
      <div className={cn(base, "border border-dashed border-status-circle/60 bg-bg/25 text-fg")}>
        <span>
          Выключите ТВ на <b className="font-medium">{consoleView.name}</b>, если гости ушли
        </span>
      </div>
    );
  }

  const graceUntilMs = session.grace_until ? Date.parse(session.grace_until) : null;
  if (session.kind === "paid" && graceUntilMs !== null && graceUntilMs > nowMs) {
    return (
      <div className={cn(base, "bg-surface-2 text-fg-muted")}>
        <span className="flex-1">
          Выбор игры · <span className="num text-fg">{formatDuration(graceUntilMs - nowMs)}</span>
        </span>
        <button
          type="button"
          className="whitespace-nowrap text-[13px] text-fg underline underline-offset-[3px]"
          onClick={act(onCancel)}
        >
          Отменить без оплаты
        </button>
      </div>
    );
  }

  const bar = ordersTotal(session.orders);
  if (timing.balance > 0 && bar > 0) {
    return (
      <div className={cn(base, "border border-line text-fg-muted")}>
        <span className="min-w-0 flex-1">Не оплачен бар: {summarizeOrders(session.orders, productName)}</span>
        <span className="num font-bold text-fg">{formatAmount(Math.min(bar, timing.balance))}</span>
      </div>
    );
  }
  return null;
}

function CardBill({ timing, consoleView }: { timing: CardTiming; consoleView: HallConsoleResponse }) {
  const session = consoleView.session;
  if (!session) return null;
  const bar = ordersTotal(session.orders);
  const item = (label: string, value: number, emphasis?: "due" | "ok") => (
    <span key={label} className={cn(emphasis === "due" && "font-semibold text-fg")}>
      {label}
      <b className={cn("num block text-base font-bold text-fg", emphasis === "ok" && "text-status-triangle")}>
        {formatAmount(value)}
      </b>
    </span>
  );

  let content: ReactNode;
  switch (timing.status) {
    case "open_running":
      content = [
        item("Время", timing.chargeTotal - bar),
        item("Бар", bar),
        item("К оплате", timing.balance, "due"),
      ];
      break;
    case "free_session":
      content = bar > 0 ? item("Бар к оплате", timing.balance, "due") : <span>Без оплаты · в отчётах отдельной строкой</span>;
      break;
    case "service_session":
      content = <span>Служебная · в загрузку зала не попадает</span>;
      break;
    default:
      content = [
        item("Счёт", timing.chargeTotal),
        timing.balance > 0 ? item("К оплате", timing.balance, "due") : item("Оплачено", consoleView.paid_total, "ok"),
      ];
  }
  return <div className="mb-3 flex gap-[18px] text-[13px] text-fg-muted short:mb-2">{content}</div>;
}

function CardActions({
  timing,
  act,
  onStart,
  onExtend,
  onStop,
  onPay,
  onBar,
}: ConsoleCardProps & { timing: CardTiming; act: Act }) {
  const owes = timing.balance > 0;
  const primary = "flex-[1.7]";
  switch (timing.status) {
    case "free":
      return (
        <Button variant="state" size="lg" data-tone="cross" onClick={act(onStart)}>
          Начать сессию
        </Button>
      );
    case "maintenance":
      return null;
    case "package_running":
      return (
        <>
          <Button variant="outline" onClick={act(onExtend)}>Продлить</Button>
          <Button variant="outline" onClick={act(onBar)}>Бар</Button>
          {owes ? (
            <Button variant="state" className={primary} onClick={act(onPay)}>
              Принять {formatAmount(timing.balance)}
            </Button>
          ) : (
            <Button variant="outline" onClick={act(onStop)}>Стоп</Button>
          )}
        </>
      );
    case "package_warn":
      return (
        <>
          <Button variant="state" className={primary} onClick={act(onExtend)}>Продлить</Button>
          <Button variant="outline" onClick={act(onBar)}>Бар</Button>
          {owes ? (
            <Button variant="outline" onClick={act(onPay)}>Оплата</Button>
          ) : (
            <Button variant="outline" onClick={act(onStop)}>Стоп</Button>
          )}
        </>
      );
    case "package_overtime":
      // The card is already red: the fix stays neutral so it doesn't read as "danger".
      return (
        <>
          <Button className={primary} onClick={act(onExtend)}>Продлить</Button>
          <Button variant="outline" onClick={act(onStop)}>Завершить</Button>
        </>
      );
    case "open_running":
      return (
        <>
          <Button variant="outline" onClick={act(onBar)}>Бар</Button>
          <Button variant="state" className={primary} onClick={act(onStop)}>
            Рассчитать · {formatAmount(timing.balance)}
          </Button>
        </>
      );
    case "free_session":
      return (
        <>
          <Button variant="outline" onClick={act(onBar)}>Бар</Button>
          <Button variant="state" className={primary} onClick={act(onStop)}>Завершить</Button>
        </>
      );
    case "service_session":
      return <Button variant="state" onClick={act(onStop)}>Завершить</Button>;
  }
}
```

- [ ] **Step 5: Hotkeys**

```ts
// web/src/features/hall/useHallHotkeys.ts
import { useEffect } from "react";
import type { HallConsoleResponse } from "@/lib/api";

/** Keys 1–9 open the n-th console: the till is a keyboard-first workstation. */
export function useHallHotkeys(
  consoles: HallConsoleResponse[],
  onOpen: (consoleView: HallConsoleResponse) => void,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      // An open sheet or dialog owns the keyboard.
      if (document.querySelector('[role="dialog"]')) return;
      if (!/^[1-9]$/.test(event.key)) return;
      const consoleView = consoles[Number(event.key) - 1];
      if (!consoleView) return;
      event.preventDefault();
      onOpen(consoleView);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [consoles, onOpen, enabled]);
}
```

- [ ] **Step 6: Wire details, card props and hotkeys into `HallPage.tsx`**

1. Imports: add `useCallback` to the React import, then `import { SessionSheet } from "./SessionSheet";` and `import { useHallHotkeys } from "./useHallHotkeys";`.
2. `DialogState`: add the member `| { kind: "details"; consoleId: number }`.
3. `finishSession`: when the stopped session owes nothing and the stop was not started from close-day, close whatever panel is open (the details sheet would otherwise stay on a now-free console):

```tsx
  function finishSession(sessionId: number, returnTo?: "close-day") {
    runSessionAction(async () => {
      const stopped = await stop(sessionId);
      if (stopped.balance > 0) {
        setDialog({ kind: "settle", sessionId: stopped.id, balance: stopped.balance, returnTo });
      } else {
        setDialog(returnTo === "close-day" ? { kind: "close-day" } : { kind: "none" });
      }
    });
  }
```

4. After the derived values from Task 6, add:

```tsx
  const openConsole = useCallback(
    (consoleView: HallConsoleResponse) =>
      setDialog(
        consoleView.session
          ? { kind: "details", consoleId: consoleView.id }
          : { kind: "start", consoleId: consoleView.id },
      ),
    [],
  );
  useHallHotkeys(consoles, openConsole, hall?.business_day_open === true);
  const detailsConsole =
    dialog.kind === "details" ? consoles.find((c) => c.id === dialog.consoleId && c.session !== null) : undefined;
```

Import the type: `import type { HallConsoleResponse, SessionResponse } from "@/lib/api";` (replacing the `SessionResponse`-only type import).

5. In the card map, pass the new props (keep the existing handlers):

```tsx
              {consoles.map((consoleView, index) => {
                const session = consoleView.session;
                return (
                  <ConsoleCard
                    key={consoleView.id}
                    console={consoleView}
                    nowMs={nowMs}
                    warnMinutes={warnMinutes}
                    hotkey={index < 9 ? index + 1 : undefined}
                    productName={productName}
                    onOpen={() => openConsole(consoleView)}
                    /* …existing onStart / onExtend / onStop / onCancel / onPay / onBar… */
                  />
                );
              })}
```

6. `<HallHelp />` becomes `<HallHelp hotkeys />`.
7. Next to the other dialog renders, add:

```tsx
      {detailsConsole && (
        <SessionSheet
          open
          onOpenChange={(open) => !open && closeDialog()}
          consoleView={detailsConsole}
          nowMs={nowMs}
          warnMinutes={warnMinutes}
          productName={productName}
          stopping={stopping}
          onPay={() => setDialog({ kind: "pay", sessionId: detailsConsole.session!.id })}
          onExtend={() => setDialog({ kind: "extend", sessionId: detailsConsole.session!.id })}
          onBar={() => setDialog({ kind: "bar", sessionId: detailsConsole.session!.id })}
          onStop={() => finishSession(detailsConsole.session!.id)}
        />
      )}
```

- [ ] **Step 7: Run everything**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src web/tests
git commit -m "Redesign the console card and open session details from it"
```

---

### Task 8: Start and extend sheets

**Files:**
- Create: `web/src/features/hall/TariffTile.tsx`
- Modify: `web/src/features/hall/StartSessionDialog.tsx`, `web/src/features/hall/ExtendSessionDialog.tsx`, `web/src/features/hall/LatePackageWarning.tsx`, `web/src/features/hall/HallPage.tsx` (pass `consoleName`)
- Test: `web/tests/StartSessionDialog.test.tsx`, `web/tests/ExtendSessionDialog.test.tsx`, `web/tests/HallPage.test.tsx` (copy only)

**Interfaces:**
- Consumes: `Sheet*`, `SegmentedControl`, `StateChip`, `Button variant="state"` (Task 3); `formatClock` (Task 1); `formatSom`, `pluralRu` (Task 1); `packageEndsAfterPlannedClose`, `estimateExtendStartMs` (`plannedClose.ts`).
- Produces: `TariffTile({ tariff, selected, onSelect, prefix?, endsLabel, late? })` — a `button` with `aria-pressed`, whose accessible name starts with the tariff name.
- Produces: `StartSessionDialog` props add `consoleName: string`; `ExtendSessionDialog` props add `consoleName: string`; `LatePackageWarning({ endsAtMs: number, plannedClose: string })`.

**Copy:**
- Start sheet title: `{consoleName}`, chip `Свободна`. Kind group label `Тип сессии`. The start button reads `Начать на {consoleName}`, plus ` · {price}` for a paid package.
- Tiles: name; `400 сом` or `160 сом/ч, поминутно`; `до 03:43` / `до 05:43 · после закрытия` (amber) / `оплата при уходе`.
- Late warning: `Пакет закончится в {HH:MM} — после планового закрытия ({plannedClose}). Продавать или нет — решаете вы.`
- Grace note: `Первые {N} {минута|минуты|минут} — на выбор игры. Если гости уйдут за это время, сессию можно отменить без оплаты.`
- Free: label `Причина`, chips `Друзья владельца`, `Компенсация`. Service note: `Обновления, проверка геймпадов, ТВ для себя. Денег нет, в загрузку зала не попадает.`
- Extend sheet: title `{consoleName}`, chip `Продление`. Package tiles are prefixed `+`; the open tile reads `с {HH:MM}, поминутно`. Button `Продлить`.

- [ ] **Step 1: Update the tests to the new copy (they now fail)**

`web/tests/StartSessionDialog.test.tsx`: render with `consoleName="PS5-1"` added to every `<StartSessionDialog … />`, then:

| Old | New |
|---|---|
| `screen.getByText("1 час — 150 сом")` (wait + click) | `screen.getByRole("button", { name: /^1 час/ })` |
| `screen.getByText("5 часов — 700 сом")` | `screen.getByRole("button", { name: /^5 часов/ })` |
| `getByRole("button", { name: "Начать" })` | `getByRole("button", { name: /^Начать на PS5-1/ })` |
| `/Пакет закончится после планового закрытия \(05:00\)/` | `/после планового закрытия \(05:00\)/` |
| `queryByText(/Пакет закончится после планового закрытия/)` | `queryByText(/после планового закрытия/)` |

Add one test:

```tsx
  it("prices the start button and marks a tile that runs past closing", async () => {
    // reuse this file's existing tariffs/settings fetch stub (planned_close "05:00")
    renderDialog(); // the file's existing helper, now passing consoleName="PS5-1"
    fireEvent.click(await screen.findByRole("button", { name: /^1 час/ }));
    expect(screen.getByRole("button", { name: "Начать на PS5-1 · 150 сом" })).toBeInTheDocument();
  });
```

(If the file has no shared render helper, inline the same `render(…)` call the other tests use.)

`web/tests/ExtendSessionDialog.test.tsx`: add `consoleName="PS5-1"`, then:

| Old | New |
|---|---|
| `screen.getByText("5 часов — 700 сом")` | `screen.getByRole("button", { name: /^\+5 часов/ })` |
| `screen.getByText("2 часа — 300 сом")` | `screen.getByRole("button", { name: /^\+2 часа/ })` |
| `/Пакет закончится после планового закрытия \(05:00\)/` | `/после планового закрытия \(05:00\)/` |

(`getByText(/Открытое время/)` keeps working: the open tile's name span is `Открытое время`.)

`web/tests/HallPage.test.tsx`: `getByRole("button", { name: "Начать" })` → `getByRole("button", { name: /^Начать на/ })`.

Run: `npm test -- tests/StartSessionDialog.test.tsx tests/ExtendSessionDialog.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement**

```tsx
// web/src/features/hall/TariffTile.tsx
import type { TariffResponse } from "@/lib/api";
import { formatSom } from "@/lib/format";
import { cn } from "@/lib/utils";

interface TariffTileProps {
  tariff: TariffResponse;
  selected: boolean;
  onSelect: () => void;
  /** "+" on the extend sheet. */
  prefix?: string;
  endsLabel: string;
  /** Ends after the planned close: advisory, the operator decides. */
  late?: boolean;
}

export function priceLabel(tariff: TariffResponse): string {
  return tariff.kind === "package" ? formatSom(tariff.price ?? 0) : `${formatSom(tariff.hourly_rate ?? 0)}/ч, поминутно`;
}

export function TariffTile({ tariff, selected, onSelect, prefix = "", endsLabel, late = false }: TariffTileProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-tone={tariff.kind === "open" ? "triangle" : "cross"}
      onClick={onSelect}
      className="grid gap-0.5 rounded-xl border border-line bg-bg p-3.5 text-left transition-colors hover:border-hover-line aria-pressed:border-tone aria-pressed:shadow-[inset_0_0_0_1px_hsl(var(--c)),0_0_24px_-6px_hsl(var(--c))]"
    >
      <span className="font-display text-[22px] font-bold leading-tight">
        {prefix}
        {tariff.name}
      </span>
      <span className="text-[13.5px] text-fg-muted">{priceLabel(tariff)}</span>
      <span className={cn("mt-1.5 text-xs text-fg-faint", late && "text-status-amber-text")}>{endsLabel}</span>
    </button>
  );
}
```

```tsx
// web/src/features/hall/LatePackageWarning.tsx
import { formatClock } from "@/lib/bishkek";

interface LatePackageWarningProps {
  endsAtMs: number;
  plannedClose: string;
}

/** Advisory only (SPEC §3.6): selling a package past closing is the operator's call. */
export function LatePackageWarning({ endsAtMs, plannedClose }: LatePackageWarningProps) {
  return (
    <p className="note note-warn">
      <span aria-hidden className="mr-1 font-bold text-status-amber-text">!</span>
      Пакет закончится в {formatClock(endsAtMs)} — после планового закрытия ({plannedClose}). Продавать или нет — решаете вы.
    </p>
  );
}
```

Replace `web/src/features/hall/StartSessionDialog.tsx` entirely:

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StateChip } from "@/components/ui/state-chip";
import type { Tone } from "@/components/ui/tone";
import { api, type SessionKind, type TariffResponse } from "@/lib/api";
import { formatClock } from "@/lib/bishkek";
import { serverNow } from "@/lib/clock";
import { formatSom, pluralRu } from "@/lib/format";
import { LatePackageWarning } from "./LatePackageWarning";
import { TariffTile } from "./TariffTile";
import { packageEndsAfterPlannedClose } from "./plannedClose";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

interface StartSessionDialogProps {
  open: boolean;
  consoleId: number;
  consoleName: string;
  onOpenChange: (open: boolean) => void;
  onStarted: () => void;
}

const REASONS = ["Друзья владельца", "Компенсация"];

export function StartSessionDialog({ open, consoleId, consoleName, onOpenChange, onStarted }: StartSessionDialogProps) {
  const tariffsQuery = useQuery({ queryKey: ["tariffs"], queryFn: api.tariffs, enabled: open });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings, enabled: open });
  const [kind, setKind] = useState<SessionKind>("paid");
  const [tariffId, setTariffId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();

  const tariffs = tariffsQuery.data ?? [];
  const selectedTariff = tariffs.find((t) => t.id === tariffId);
  const graceMinutes = settingsQuery.data?.grace_minutes ?? 3;
  const plannedClose = settingsQuery.data?.planned_close;
  const packageStartMs = serverNow() + graceMinutes * 60_000;

  const endsAt = (tariff: TariffResponse) =>
    tariff.kind === "package" && tariff.duration_min != null ? packageStartMs + tariff.duration_min * 60_000 : null;
  const isLate = (tariff: TariffResponse) =>
    tariff.kind === "package" &&
    tariff.duration_min != null &&
    plannedClose !== undefined &&
    packageEndsAfterPlannedClose(packageStartMs, tariff.duration_min, plannedClose);
  const endsLabel = (tariff: TariffResponse) => {
    const end = endsAt(tariff);
    if (end === null) return "оплата при уходе";
    return `до ${formatClock(end)}${isLate(tariff) ? " · после закрытия" : ""}`;
  };

  const showsLateWarning = kind === "paid" && selectedTariff !== undefined && isLate(selectedTariff);
  const buttonTone: Tone =
    kind === "free" ? "square" : kind === "service" ? "muted" : selectedTariff?.kind === "open" ? "triangle" : "cross";
  const priceSuffix =
    kind === "paid" && selectedTariff?.kind === "package" && selectedTariff.price != null
      ? ` · ${formatSom(selectedTariff.price)}`
      : "";

  const startMutation = useMutation({
    mutationFn: () =>
      api.startSession({
        console_id: consoleId,
        kind,
        tariff_id: kind === "paid" ? tariffId : null,
        reason: kind === "free" ? reason : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY });
      onStarted();
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent tone="idle">
        <SheetHeader>
          <SheetTitle>{consoleName}</SheetTitle>
          <StateChip tone="idle">Свободна</StateChip>
        </SheetHeader>
        <SheetBody>
          <div>
            <span className="field-label">Тип сессии</span>
            <SegmentedControl
              ariaLabel="Тип сессии"
              value={kind}
              onChange={setKind}
              options={[
                { value: "paid", label: "Платная" },
                {
                  value: "free",
                  label: (
                    <>
                      <span aria-hidden className="text-xs font-bold text-status-square">□</span>
                      Бесплатная
                    </>
                  ),
                },
                { value: "service", label: "Служебная" },
              ]}
            />
          </div>

          {kind === "paid" && (
            <>
              <div>
                <span className="field-label">Тариф</span>
                <div className="grid grid-cols-2 gap-2.5">
                  {tariffs.map((tariff) => (
                    <TariffTile
                      key={tariff.id}
                      tariff={tariff}
                      selected={tariffId === tariff.id}
                      onSelect={() => setTariffId(tariff.id)}
                      endsLabel={endsLabel(tariff)}
                      late={isLate(tariff)}
                    />
                  ))}
                </div>
              </div>
              {showsLateWarning && plannedClose && selectedTariff && (
                <LatePackageWarning endsAtMs={endsAt(selectedTariff)!} plannedClose={plannedClose} />
              )}
              <p className="note">
                Первые {graceMinutes} {pluralRu(graceMinutes, ["минута", "минуты", "минут"])} — на выбор игры. Если гости
                уйдут за это время, сессию можно отменить без оплаты.
              </p>
            </>
          )}

          {kind === "free" && (
            <div>
              <label htmlFor="reason" className="field-label">
                Причина
              </label>
              <Input id="reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Например: друзья владельца" />
              <div className="mt-2 flex flex-wrap gap-2">
                {REASONS.map((text) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => setReason(text)}
                    className="h-[30px] rounded-full border border-line px-3 text-[13px] text-fg-muted hover:border-hover-line hover:text-fg"
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          )}

          {kind === "service" && (
            <p className="note">Обновления, проверка геймпадов, ТВ для себя. Денег нет, в загрузку зала не попадает.</p>
          )}

          {startMutation.isError && (
            <p role="alert" className="text-sm text-status-circle">
              Не удалось начать сессию. Попробуйте ещё раз.
            </p>
          )}
        </SheetBody>
        <SheetFooter>
          <Button
            variant="state"
            size="lg"
            data-tone={buttonTone}
            onClick={() => startMutation.mutate()}
            disabled={
              startMutation.isPending ||
              (kind === "paid" && tariffId === null) ||
              (kind === "free" && reason.trim().length === 0)
            }
          >
            Начать на {consoleName}
            {priceSuffix}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

Replace `web/src/features/hall/ExtendSessionDialog.tsx` entirely:

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StateChip } from "@/components/ui/state-chip";
import { api, type SegmentResponse, type TariffResponse } from "@/lib/api";
import { formatClock } from "@/lib/bishkek";
import { serverNow } from "@/lib/clock";
import { LatePackageWarning } from "./LatePackageWarning";
import { TariffTile } from "./TariffTile";
import { estimateExtendStartMs, packageEndsAfterPlannedClose } from "./plannedClose";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

interface ExtendSessionDialogProps {
  open: boolean;
  sessionId: number;
  consoleName: string;
  segments: SegmentResponse[];
  onOpenChange: (open: boolean) => void;
  onExtended: () => void;
}

export function ExtendSessionDialog({ open, sessionId, consoleName, segments, onOpenChange, onExtended }: ExtendSessionDialogProps) {
  const tariffsQuery = useQuery({ queryKey: ["tariffs"], queryFn: api.tariffs, enabled: open });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings, enabled: open });
  const [tariffId, setTariffId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const tariffs = tariffsQuery.data ?? [];
  const selectedTariff = tariffs.find((t) => t.id === tariffId);
  const plannedClose = settingsQuery.data?.planned_close;
  // Open time queued behind a running package starts at the package's end (CLAUDE.md rule 3).
  const startMs = estimateExtendStartMs(serverNow(), segments[segments.length - 1]);

  const isLate = (tariff: TariffResponse) =>
    tariff.kind === "package" &&
    tariff.duration_min != null &&
    plannedClose !== undefined &&
    packageEndsAfterPlannedClose(startMs, tariff.duration_min, plannedClose);
  const endsLabel = (tariff: TariffResponse) =>
    tariff.kind === "package" && tariff.duration_min != null
      ? `до ${formatClock(startMs + tariff.duration_min * 60_000)}${isLate(tariff) ? " · после закрытия" : ""}`
      : `с ${formatClock(startMs)}, поминутно`;

  const extendMutation = useMutation({
    mutationFn: () => api.extendSession(sessionId, tariffId as number),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY });
      onExtended();
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent tone="cross">
        <SheetHeader>
          <SheetTitle>{consoleName}</SheetTitle>
          <StateChip tone="cross">Продление</StateChip>
        </SheetHeader>
        <SheetBody>
          <div>
            <span className="field-label">Продлить на</span>
            <div className="grid grid-cols-2 gap-2.5">
              {tariffs.map((tariff) => (
                <TariffTile
                  key={tariff.id}
                  tariff={tariff}
                  prefix={tariff.kind === "package" ? "+" : ""}
                  selected={tariffId === tariff.id}
                  onSelect={() => setTariffId(tariff.id)}
                  endsLabel={endsLabel(tariff)}
                  late={isLate(tariff)}
                />
              ))}
            </div>
          </div>
          {selectedTariff && isLate(selectedTariff) && plannedClose && (
            <LatePackageWarning endsAtMs={startMs + (selectedTariff.duration_min ?? 0) * 60_000} plannedClose={plannedClose} />
          )}
          {extendMutation.isError && (
            <p role="alert" className="text-sm text-status-circle">
              Не удалось продлить сессию. Попробуйте ещё раз.
            </p>
          )}
        </SheetBody>
        <SheetFooter>
          <Button
            variant="state"
            size="lg"
            data-tone={selectedTariff?.kind === "open" ? "triangle" : "cross"}
            onClick={() => extendMutation.mutate()}
            disabled={tariffId === null || extendMutation.isPending}
          >
            Продлить
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

In `HallPage.tsx`, pass names:
- `StartSessionDialog`: `consoleName={consoles.find((c) => c.id === dialog.consoleId)?.name ?? ""}`.
- `ExtendSessionDialog`: `consoleName={consoles.find((c) => c.session?.id === extendTarget.id)?.name ?? ""}`.

- [ ] **Step 3: Run everything**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/features/hall web/tests
git commit -m "Turn start and extend into sheets with tariff tiles"
```

---

### Task 9: Payment and bar sheets

**Files:**
- Modify: `web/src/features/hall/PaymentDialog.tsx`, `web/src/features/hall/BarDialog.tsx`, `web/src/features/hall/HallPage.tsx` (pass `targetName`)
- Index.css: append the product-tile styles to `@layer components`
- Test: `web/tests/PaymentDialog.test.tsx`, `web/tests/BarDialog.test.tsx`, `web/tests/HallPage.test.tsx` (copy only)

**Interfaces:**
- Consumes: `groupOrders`, `ordersTotal` (Task 4); `Sheet*`, `SegmentedControl` (Task 3).
- Produces: `PaymentDialog` props add `targetName?: string`; `BarDialog` props add `targetName: string`.

**Copy:**
- Payment: title `Оплата · остаток {formatSom(balance)}`; chip `{targetName}`; «К оплате» shown big; group `Способ оплаты` (`Наличные` / `QR` / `Перевод`); label `Сумма`; chips `Всё: {N}` and `Половина`; button `Внести {formatSom(amount)}` (just `Внести` while the amount is invalid).
- Bar: title `Бар · {targetName}`; product tiles with a qty badge; a list labelled `На счёте`, with `−` (aria `Убрать одну: {name}`) and `+` (aria `Добавить ещё: {name}`) per line; total `Бар, итого` (`data-testid="bar-total"`); empty hint `Нажмите на товар — он сразу попадёт на счёт.`; button `Готово`.

- [ ] **Step 1: Update the tests (they now fail)**

`web/tests/PaymentDialog.test.tsx`: `getByRole("button", { name: "Внести" })` → `getByRole("button", { name: /^Внести/ })` (3×).

`web/tests/BarDialog.test.tsx`: render with `targetName="PS5-1"`, then:

| Old | New |
|---|---|
| `getByRole("button", { name: "Убрать" })` (2×) | `getByRole("button", { name: /^Убрать одну/ })` |
| `expect(screen.getByText("Бар — на счету 160 сом")).toBeInTheDocument();` | `expect(screen.getByTestId("bar-total")).toHaveTextContent("160 сом");` |

Add:

```tsx
  it("groups repeated taps into one line and removes a single unit with −", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/products") return { ok: true, json: async () => [{ id: 1, name: "Кола", price: 80, is_active: true }] };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    renderDialog([order({ id: 1 }), order({ id: 2, created_at: new Date(Date.now() + 1000).toISOString() })]);

    await waitFor(() => expect(screen.getByRole("button", { name: "Убрать одну: Кола" })).toBeInTheDocument());
    expect(screen.getByTestId("bar-total")).toHaveTextContent("160 сом");
    fireEvent.click(screen.getByRole("button", { name: "Убрать одну: Кола" }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls as unknown as [string, RequestInit | undefined][];
      expect(calls.some(([url, init]) => url === "/api/orders/2" && init?.method === "DELETE")).toBe(true);
    });
  });
```

(`renderDialog` in this file must pass `targetName="PS5-1"`.)

`web/tests/HallPage.test.tsx`:

| Old | New |
|---|---|
| `"Оплата — остаток …"` (every string and regex) | `"Оплата · остаток …"` |
| `/Оплата — остаток/` | `/Оплата · остаток/` |
| `getByRole("button", { name: "Внести" })` | `getByRole("button", { name: /^Внести/ })` |
| `getByText("Бар — на счету 0 сом")` (console) | `getByRole("dialog", { name: "Бар · PS5-1" })` |
| `getByText("Бар — на счету 0 сом")` (new ticket) | `getByRole("dialog", { name: /^Бар · Чек №/ })` |

Run: `npm test -- tests/PaymentDialog.test.tsx tests/BarDialog.test.tsx tests/HallPage.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement**

Append inside `@layer components` in `web/src/index.css`:

```css
  .product-tile {
    @apply relative grid min-h-[72px] content-between gap-1.5 rounded-xl border border-line bg-bg px-3 py-2.5 text-left transition-colors hover:border-hover-line active:scale-[0.98] disabled:opacity-60;
  }
  .qty-badge {
    @apply absolute -right-[7px] -top-[7px] grid h-[22px] min-w-[22px] place-items-center rounded-full bg-fg px-1.5 font-mono text-xs font-bold text-ink;
  }
```

Replace `web/src/features/hall/PaymentDialog.tsx` entirely:

```tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StateChip } from "@/components/ui/state-chip";
import { api, type PaymentMethod } from "@/lib/api";
import { formatAmount, formatSom } from "@/lib/format";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

interface PaymentDialogProps {
  open: boolean;
  sessionId: number;
  balance: number;
  /** "PS 2" or "Чек №214", shown in the header. */
  targetName?: string;
  onOpenChange: (open: boolean) => void;
  /** Called after each successful payment with the amount just recorded. */
  onPaid: (amount: number) => void;
}

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Наличные" },
  { value: "qr", label: "QR" },
  { value: "transfer", label: "Перевод" },
];

export function PaymentDialog({ open, sessionId, balance, targetName, onOpenChange, onPaid }: PaymentDialogProps) {
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const queryClient = useQueryClient();

  const payMutation = useMutation({
    mutationFn: (paidAmount: number) => api.paySession(sessionId, paidAmount, method),
    onSuccess: (_payment, paidAmount) => {
      queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY });
      onPaid(paidAmount);
      setAmount("");
    },
  });

  const amountValue = Number(amount);
  const isValidAmount = amount.trim() !== "" && Number.isFinite(amountValue) && amountValue > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent tone="muted">
        <SheetHeader>
          <SheetTitle>Оплата · остаток {formatSom(balance)}</SheetTitle>
          {targetName && <StateChip tone="muted">{targetName}</StateChip>}
        </SheetHeader>
        <SheetBody>
          <div className="flex items-baseline justify-between rounded-xl border border-line bg-bg px-3.5 py-3">
            <span className="text-[13.5px] text-fg-muted">К оплате</span>
            <span className="num text-[26px] font-bold">
              {formatAmount(balance)}
              <span className="ml-1 font-sans text-sm font-normal text-fg-muted">сом</span>
            </span>
          </div>
          <div>
            <span className="field-label">Способ оплаты</span>
            <SegmentedControl ariaLabel="Способ оплаты" value={method} onChange={setMethod} options={METHODS} />
          </div>
          <div>
            <label htmlFor="amount" className="field-label">
              Сумма
            </label>
            <Input
              id="amount"
              type="number"
              inputMode="numeric"
              className="num h-12 text-xl"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <ChipButton onClick={() => setAmount(String(balance))}>Всё: {formatAmount(balance)}</ChipButton>
              <ChipButton onClick={() => setAmount(String(Math.floor(balance / 2)))}>Половина</ChipButton>
            </div>
          </div>
          {payMutation.isError && (
            <p role="alert" className="text-sm text-status-circle">
              Не удалось провести оплату. Попробуйте ещё раз.
            </p>
          )}
        </SheetBody>
        <SheetFooter>
          <Button size="lg" onClick={() => payMutation.mutate(amountValue)} disabled={!isValidAmount || payMutation.isPending}>
            Внести{isValidAmount ? ` ${formatSom(amountValue)}` : ""}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ChipButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-[30px] rounded-full border border-line px-3 text-[13px] text-fg-muted hover:border-hover-line hover:text-fg"
    >
      {children}
    </button>
  );
}
```

(Add `import type React from "react";` or use `ReactNode` from `"react"` for the `children` type.)

Replace `web/src/features/hall/BarDialog.tsx` entirely:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, type OrderResponse } from "@/lib/api";
import { formatAmount, formatSom } from "@/lib/format";
import { groupOrders, ordersTotal } from "./barLines";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

interface BarDialogProps {
  open: boolean;
  sessionId: number;
  /** "PS 2" or "Чек №214". */
  targetName: string;
  orders: OrderResponse[];
  onOpenChange: (open: boolean) => void;
}

export function BarDialog({ open, sessionId, targetName, orders, onOpenChange }: BarDialogProps) {
  const productsQuery = useQuery({ queryKey: ["products"], queryFn: api.products, enabled: open });
  const queryClient = useQueryClient();
  const invalidateHall = () => queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY });

  // Each tap adds one qty-1 row and a correction deletes a row (Stage 4 decision): the
  // grouped −/+ view is presentation only, the API calls are unchanged.
  const addMutation = useMutation({
    mutationFn: (productId: number) => api.addOrder(sessionId, productId, 1),
    onSuccess: invalidateHall,
  });
  const removeMutation = useMutation({
    mutationFn: (orderId: number) => api.removeOrder(orderId),
    onSuccess: invalidateHall,
  });

  const productName = (productId: number) =>
    productsQuery.data?.find((p) => p.id === productId)?.name ?? `Товар ${productId}`;
  const lines = groupOrders(orders);
  const qtyOf = (productId: number) => lines.find((line) => line.productId === productId)?.qty ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent tone="muted">
        <SheetHeader>
          <SheetTitle>Бар · {targetName}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <div className="grid grid-cols-3 gap-2">
            {(productsQuery.data ?? []).map((product) => {
              const qty = qtyOf(product.id);
              return (
                <button
                  key={product.id}
                  type="button"
                  className="product-tile"
                  aria-label={`${product.name}, ${product.price} сом${qty ? `, на счёте ${qty}` : ""}`}
                  onClick={() => addMutation.mutate(product.id)}
                  disabled={addMutation.isPending}
                >
                  <span className="text-[13.5px] font-medium leading-tight">{product.name}</span>
                  <span className="num text-sm font-bold text-fg-muted">{formatAmount(product.price)}</span>
                  {qty > 0 && (
                    <span aria-hidden className="qty-badge">
                      {qty}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div>
            <span className="field-label">На счёте</span>
            {lines.length === 0 ? (
              <p className="py-2 text-[13.5px] text-fg-faint">Нажмите на товар — он сразу попадёт на счёт.</p>
            ) : (
              lines.map((line) => {
                const name = productName(line.productId);
                return (
                  <div
                    key={line.productId}
                    className="grid grid-cols-[minmax(0,1fr)_auto_64px] items-center gap-2.5 border-b border-line py-2 text-sm last:border-b-0"
                  >
                    <span>{name}</span>
                    <span className="inline-flex items-center overflow-hidden rounded-[10px] border border-line">
                      <button
                        type="button"
                        aria-label={`Убрать одну: ${name}`}
                        className="h-8 w-[34px] bg-surface-2 text-base hover:bg-hover"
                        onClick={() => removeMutation.mutate(line.removableOrderId)}
                        disabled={removeMutation.isPending}
                      >
                        −
                      </button>
                      <span className="num min-w-[30px] text-center font-bold">{line.qty}</span>
                      <button
                        type="button"
                        aria-label={`Добавить ещё: ${name}`}
                        className="h-8 w-[34px] bg-surface-2 text-base hover:bg-hover"
                        onClick={() => addMutation.mutate(line.productId)}
                        disabled={addMutation.isPending}
                      >
                        +
                      </button>
                    </span>
                    <span className="num text-right font-bold">{formatAmount(line.total)}</span>
                  </div>
                );
              })
            )}
            <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2.5">
              <span className="text-fg-muted">Бар, итого</span>
              <span data-testid="bar-total" className="num text-2xl font-extrabold">
                {formatSom(ordersTotal(orders))}
              </span>
            </div>
          </div>

          {addMutation.isError && (
            <p role="alert" className="text-sm text-status-circle">
              Не удалось добавить товар. Попробуйте ещё раз.
            </p>
          )}
          {removeMutation.isError && (
            <p role="alert" className="text-sm text-status-circle">
              Не удалось убрать товар. Попробуйте ещё раз.
            </p>
          )}
        </SheetBody>
        <SheetFooter>
          <Button size="lg" onClick={() => onOpenChange(false)}>
            Готово
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

In `HallPage.tsx`:
- `BarDialog`: `targetName={consoles.find((c) => c.session?.id === barTarget.id)?.name ?? `Чек №${barTarget.id}`}`.
- `PaymentDialog` (pay): `targetName={consoles.find((c) => c.session?.id === payTarget.id)?.name ?? `Чек №${payTarget.id}`}`.

- [ ] **Step 3: Run everything**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src web/tests
git commit -m "Turn payment and bar into sheets with grouped bar lines"
```

---

### Task 10: Close-day as three steps

**Files:**
- Modify: `web/src/features/hall/CloseBusinessDayDialog.tsx` (render only; queries, mutation and props unchanged)
- Index.css: step counter styles
- Test: `web/tests/CloseBusinessDayDialog.test.tsx`, `web/tests/HallPage.test.tsx` (copy only)

**Copy (a real sequence, so the steps are numbered):**
1. `Завершить активные сессии`: the note `Нельзя закрыть день, пока есть незавершённые сессии.` when some remain, otherwise `Все сессии завершены.`. Each row is a `listitem` named by its label, shows the balance or `оплачено`, and has a `Завершить` button.
2. `Пересчитать наличные`: `Должно быть в кассе` = expected, with `{opening} на начало + {cash_total} за день`; label `Посчитано наличных`; `Расхождение` → `—` / `сходится` / `formatSignedSom(diff)`.
3. `Сверить безнал с банком`: rows `QR` and `Перевод по номеру`, each with a checkbox `сверил` (a memory aid, not required), then `Сессий: N · Часы игры: X · Бар: Y сом`.

Footer: `Отмена`, `Закрыть день и отправить сводку`.

- [ ] **Step 1: Update the tests (they now fail)**

`web/tests/CloseBusinessDayDialog.test.tsx` (add `within` to the imports):

| Old | New |
|---|---|
| `getByText(/PS5-2 — 150 сом/)` | `within(screen.getByRole("listitem", { name: "PS5-2" })).getByText("150 сом")` |
| `getByText(/Чек №20 — 80 сом/)` | `within(screen.getByRole("listitem", { name: "Чек №20" })).getByText("80 сом")` |
| `getByText("Наличные ожидается: 5 300 сом")` | `getByText("Должно быть в кассе")` then `expect(screen.getByTestId("expected-cash")).toHaveTextContent("5 300 сом")` |
| `getByText("QR: 200 сом")` | `expect(screen.getByText("QR").closest("label")).toHaveTextContent("200 сом")` |
| `getByText("Перевод: 100 сом")` | `expect(screen.getByText("Перевод по номеру").closest("label")).toHaveTextContent("100 сом")` |
| `getByText("Сессий: 2")` | unchanged |
| `getByText("Часов: 1 ч 30 мин")` | `getByText("Часы игры: 1 ч 30 мин")` |
| `getByText("Продажи бара: 160 сом")` | `getByText("Бар: 160 сом")` |
| `getByText(/Расхождение: −100 сом/)` | `expect(screen.getByTestId("discrepancy")).toHaveTextContent("−100 сом")` |
| `getByRole("button", { name: "Закрыть день" })` (inside the dialog test) | `getByRole("button", { name: "Закрыть день и отправить сводку" })` |

`web/tests/HallPage.test.tsx`: `getByText("Наличные ожидается: 5 000 сом")` (2×) → `getByTestId("expected-cash")` with `toHaveTextContent("5 000 сом")`.

Run: `npm test -- tests/CloseBusinessDayDialog.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement**

Append inside `@layer components` in `web/src/index.css`:

```css
  .close-steps {
    counter-reset: step;
  }
  .close-steps > li {
    @apply grid grid-cols-[28px_minmax(0,1fr)] gap-3 border-b border-line py-4 last:border-b-0;
    counter-increment: step;
  }
  .close-steps > li::before {
    @apply grid h-7 w-7 place-items-center rounded-full bg-surface-2 font-mono text-[13px] text-fg-muted;
    content: counter(step);
  }
```

Replace the `return (…)` of `CloseBusinessDayDialog` (keep everything above it; add `DialogClose` to the dialog import and `formatAmount`, `formatSignedSom` to the format import):

```tsx
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[620px] gap-0 p-0">
        <DialogHeader className="border-b border-line px-6 py-5">
          <DialogTitle className="font-display text-[22px] font-bold">Закрытие дня</DialogTitle>
        </DialogHeader>

        <ol className="close-steps max-h-[70vh] overflow-y-auto px-6 max-sm:px-4">
          <li>
            <div>
              <h3 className="mb-2.5 mt-0.5 text-[15px] font-semibold">Завершить активные сессии</h3>
              {activeEntries.length > 0 ? (
                <>
                  <p className="text-sm text-fg-muted">Нельзя закрыть день, пока есть незавершённые сессии.</p>
                  <ul>
                    {activeEntries.map((entry) => (
                      <li key={entry.sessionId} aria-label={entry.label} className="flex items-center gap-2.5 py-2 text-sm">
                        <span className="min-w-0 flex-1">{entry.label}</span>
                        <span className={entry.balance > 0 ? "num" : "text-fg-muted"}>
                          {entry.balance > 0 ? formatSom(entry.balance) : "оплачено"}
                        </span>
                        <Button variant="outline" size="sm" disabled={pending} onClick={() => onFinishSession(entry.sessionId)}>
                          Завершить
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {error && (
                    <p role="alert" className="text-sm text-status-circle">
                      {error}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-fg-muted">Все сессии завершены.</p>
              )}
            </div>
          </li>

          <li>
            <div>
              <h3 className="mb-2.5 mt-0.5 text-[15px] font-semibold">Пересчитать наличные</h3>
              {activeEntries.length > 0 ? (
                <p className="text-sm text-fg-faint">После завершения сессий.</p>
              ) : summary === undefined ? (
                <div>Загрузка…</div>
              ) : (
                <>
                  <div className="flex items-baseline gap-2.5 py-2 text-sm">
                    <span className="flex-1 text-fg-muted">
                      Должно быть в кассе
                      <small className="block text-[11.5px] text-fg-faint">
                        {formatAmount(summary.opening_cash)} на начало + {formatAmount(summary.cash_total)} за день
                      </small>
                    </span>
                    <span data-testid="expected-cash" className="num text-xl font-bold">
                      {formatSom(summary.expected_cash)}
                    </span>
                  </div>
                  <Label htmlFor="counted-cash" className="field-label">
                    Посчитано наличных
                  </Label>
                  <Input
                    id="counted-cash"
                    type="number"
                    min="0"
                    inputMode="numeric"
                    className="num h-12 text-xl"
                    placeholder="Сколько насчитали"
                    value={countedCash}
                    onChange={(event) => setCountedCash(event.target.value)}
                  />
                  <div className="flex items-baseline gap-2.5 py-2 text-sm">
                    <span className="flex-1 text-fg-muted">Расхождение</span>
                    <span
                      data-testid="discrepancy"
                      className={
                        discrepancy === null ? "num" : discrepancy === 0 ? "num text-status-triangle" : "num text-status-circle"
                      }
                    >
                      {discrepancy === null ? "—" : discrepancy === 0 ? "сходится" : formatSignedSom(discrepancy)}
                    </span>
                  </div>
                </>
              )}
            </div>
          </li>

          <li>
            <div>
              <h3 className="mb-2.5 mt-0.5 text-[15px] font-semibold">Сверить безнал с банком</h3>
              {summary && activeEntries.length === 0 ? (
                <>
                  <label className="flex items-center gap-2.5 py-1.5 text-sm">
                    <input type="checkbox" className="h-[18px] w-[18px] accent-[hsl(var(--triangle))]" />
                    <span className="flex-1">QR</span>
                    <span className="num">{formatSom(summary.qr_total)}</span>
                  </label>
                  <label className="flex items-center gap-2.5 py-1.5 text-sm">
                    <input type="checkbox" className="h-[18px] w-[18px] accent-[hsl(var(--triangle))]" />
                    <span className="flex-1">Перевод по номеру</span>
                    <span className="num">{formatSom(summary.transfer_total)}</span>
                  </label>
                  <p className="mt-2 text-[13px] text-fg-muted">
                    <span>Сессий: {summary.sessions_count}</span> · <span>Часы игры: {formatHoursMinutes(summary.minutes_total)}</span> ·{" "}
                    <span>Бар: {formatSom(summary.bar_sales_total)}</span>
                  </p>
                </>
              ) : (
                <p className="text-sm text-fg-faint">После завершения сессий.</p>
              )}
            </div>
          </li>
        </ol>

        {closeMutation.isError && (
          <p role="alert" className="px-6 text-sm text-status-circle">
            Не удалось закрыть день. Попробуйте ещё раз.
          </p>
        )}

        <DialogFooter className="gap-2 border-t border-line px-6 py-4 max-sm:flex-col-reverse">
          <DialogClose asChild>
            <Button variant="outline">Отмена</Button>
          </DialogClose>
          <Button
            onClick={() => closeMutation.mutate(countedValue)}
            disabled={activeEntries.length > 0 || !isValidCounted || closeMutation.isPending}
          >
            Закрыть день и отправить сводку
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
```

(`DialogClose` is already exported from `components/ui/dialog.tsx`. `DialogFooter`'s own classes are merged with the ones passed here.)

- [ ] **Step 3: Run everything**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src web/tests
git commit -m "Show closing the day as three numbered steps"
```

---

### Task 11: History page

**Files:**
- Create: `web/src/features/hall/HistoryPage.tsx`
- Delete: `web/src/features/hall/BusinessDayHistoryDialog.tsx`, `web/tests/BusinessDayHistoryDialog.test.tsx`
- Modify: `web/src/features/hall/HallPage.tsx` (a `view` state instead of the history dialog; hotkeys only on the hall view)
- Test: `web/tests/HistoryPage.test.tsx` (new), `web/tests/HallPage.test.tsx`

**Interfaces:**
- Consumes: `api.businessDayHistory`, `api.businessDaySummary`; `formatDayLabel`, `formatClock` (Task 1); `formatSom`, `formatAmount`, `formatSignedSom`, `formatHoursMinutes`, `pluralRu` (Task 1); `Sheet*` (Task 3).
- Produces: `HistoryPage({ onBack }: { onBack: () => void })`.

**Copy:** back button `← Зал`; `h1` `История дней`; pill `{N} {закрытый|закрытых|закрытых} {день|дня|дней}`; summary card `Расхождения` with the signed total and `{K} {день|дня|дней}`. Table columns: `День`, `На начало`, `Ожидалось`, `Насчитали`, `Расхождение`. Each row is a button: day label, `10:04 → 04:51`, amounts; the discrepancy is red when negative, `сошлось` when zero. The day sheet has sections `Наличные` (`На начало`, `Пришло за день`, `Должно было быть`, `Насчитали`, `Расхождение`), `Безнал · сверяется по банку` (`QR`, `Перевод по номеру`) and `Зал` (`Сессий`, `Часы игры`, `Бар`). Empty state: `Закрытых дней пока нет.`

Per-row QR/transfer columns need one summary request per day. Not doing that is deliberate (Global Constraints); the day sheet loads one summary.

- [ ] **Step 1: Write the failing tests**

```tsx
// web/tests/HistoryPage.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryPage } from "@/features/hall/HistoryPage";

const DAY = {
  id: 3,
  opened_at: "2026-09-24T04:00:00Z", // Thursday 10:00 in Bishkek
  closed_at: "2026-09-24T20:00:00Z", // 02:00 next night
  opening_cash: 5000,
  expected_cash: 5300,
  counted_cash: 5200,
};

function renderPage(days: unknown[], onBack = vi.fn()) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/business-days?limit=30") return { ok: true, json: async () => days };
      if (url === "/api/business-days/3/summary") {
        return {
          ok: true,
          json: async () => ({
            opening_cash: 5000, cash_total: 300, qr_total: 200, transfer_total: 100, expected_cash: 5300,
            sessions_count: 2, minutes_total: 90, bar_sales_total: 160, has_active_sessions: false,
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HistoryPage onBack={onBack} />
    </QueryClientProvider>,
  );
  return onBack;
}

describe("HistoryPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("says so when no day has been closed yet", async () => {
    renderPage([]);
    await waitFor(() => expect(screen.getByText("Закрытых дней пока нет.")).toBeInTheDocument());
  });

  it("lists a closed day with its cash reconciliation", async () => {
    renderPage([DAY, { ...DAY, id: 4, closed_at: null }]);
    const row = await screen.findByRole("button", { name: /чт, 24\.09/ });
    expect(row).toHaveTextContent("10:00 → 02:00");
    expect(row).toHaveTextContent("5 000");
    expect(row).toHaveTextContent("5 300");
    expect(row).toHaveTextContent("5 200");
    expect(row).toHaveTextContent("−100");
    expect(screen.getAllByRole("button", { name: /\d\d\.\d\d/ })).toHaveLength(1); // the open day is not listed
  });

  it("opens the day's breakdown with non-cash apart", async () => {
    renderPage([DAY]);
    fireEvent.click(await screen.findByRole("button", { name: /чт, 24\.09/ }));
    const sheet = await screen.findByRole("dialog", { name: "чт, 24.09" });
    await waitFor(() => expect(within(sheet).getByText("QR").closest("div")).toHaveTextContent("200"));
    expect(within(sheet).getByText("Перевод по номеру").closest("div")).toHaveTextContent("100");
    expect(within(sheet).getByText("Сессий").closest("div")).toHaveTextContent("2");
  });

  it("goes back to the hall", async () => {
    const onBack = renderPage([]);
    fireEvent.click(await screen.findByRole("button", { name: "← Зал" }));
    expect(onBack).toHaveBeenCalled();
  });
});
```

`web/tests/HallPage.test.tsx` — the history test becomes:

```tsx
    it("opens the history page and shows a closed day", async () => {
      /* …keep the existing fetchMock setup… */
      renderHall();

      await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "История дней" }));

      await waitFor(() => expect(screen.getByRole("heading", { name: "История дней" })).toBeInTheDocument());
      expect(await screen.findByRole("button", { name: /ср, 23\.09/ })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "← Зал" }));
      await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
    });
```

Run: `npm test -- tests/HistoryPage.test.tsx tests/HallPage.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement**

```tsx
// web/src/features/hall/HistoryPage.tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StateChip } from "@/components/ui/state-chip";
import { api, type BusinessDayResponse } from "@/lib/api";
import { formatClock, formatDayLabel } from "@/lib/bishkek";
import { formatAmount, formatHoursMinutes, formatSignedSom, formatSom, pluralRu } from "@/lib/format";
import { cn } from "@/lib/utils";

const COLUMNS = "grid-cols-[minmax(150px,1.4fr)_repeat(3,minmax(72px,1fr))_minmax(100px,1fr)]";

function discrepancyOf(day: BusinessDayResponse): number {
  return (day.counted_cash ?? 0) - (day.expected_cash ?? 0);
}

export function HistoryPage({ onBack }: { onBack: () => void }) {
  const historyQuery = useQuery({ queryKey: ["business-day-history"], queryFn: api.businessDayHistory });
  const [selected, setSelected] = useState<BusinessDayResponse | null>(null);

  const days = (historyQuery.data ?? []).filter((day) => day.closed_at !== null);
  const withDiff = days.filter((day) => discrepancyOf(day) !== 0);
  const diffTotal = withDiff.reduce((sum, day) => sum + discrepancyOf(day), 0);
  const dayWord = (n: number) => pluralRu(n, ["день", "дня", "дней"]);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={onBack} autoFocus>
          ← Зал
        </Button>
        <h1 className="font-display text-[26px] font-extrabold tracking-tight">История дней</h1>
        {days.length > 0 && (
          <span className="inline-flex h-[30px] items-center rounded-full border border-line bg-surface px-3 text-[13px] text-fg-muted">
            {days.length} {pluralRu(days.length, ["закрытый", "закрытых", "закрытых"])} {dayWord(days.length)}
          </span>
        )}
      </div>

      {historyQuery.isLoading ? (
        <div>Загрузка…</div>
      ) : days.length === 0 ? (
        <p className="text-sm text-fg-muted">Закрытых дней пока нет.</p>
      ) : (
        <>
          <div className="mb-4 inline-grid rounded-xl border border-line bg-surface px-4 py-2">
            <span className="text-[11px] text-fg-muted">Расхождения</span>
            <span className={cn("num text-lg font-bold", diffTotal < 0 && "text-status-circle")}>
              {withDiff.length === 0 ? "всё сошлось" : `${formatSignedSom(diffTotal)} · ${withDiff.length} ${dayWord(withDiff.length)}`}
            </span>
          </div>

          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div
              aria-hidden
              className={cn(
                "grid gap-3 bg-bg px-[18px] py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted max-md:hidden [&>span:not(:first-child)]:text-right",
                COLUMNS,
              )}
            >
              <span>День</span>
              <span>На начало</span>
              <span>Ожидалось</span>
              <span>Насчитали</span>
              <span>Расхождение</span>
            </div>
            {days.map((day) => {
              const diff = discrepancyOf(day);
              return (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => setSelected(day)}
                  className={cn(
                    "grid w-full items-center gap-3 border-t border-line px-[18px] py-3 text-left text-sm first-of-type:border-t-0 hover:bg-surface-2 max-md:grid-cols-4 max-md:gap-x-2 max-md:gap-y-2.5 md:first-of-type:border-t",
                    COLUMNS,
                  )}
                >
                  <span className="max-md:col-span-4">
                    <b className="block font-semibold">{formatDayLabel(Date.parse(day.opened_at))}</b>
                    <span className="text-[13px] text-fg-muted">
                      {formatClock(Date.parse(day.opened_at))} → {formatClock(Date.parse(day.closed_at!))}
                    </span>
                  </span>
                  <Cell label="На начало" value={formatAmount(day.opening_cash)} />
                  <Cell label="Ожидалось" value={formatAmount(day.expected_cash ?? 0)} />
                  <Cell label="Насчитали" value={formatAmount(day.counted_cash ?? 0)} />
                  <Cell
                    label="Расхождение"
                    value={diff === 0 ? "сошлось" : formatSignedSom(diff).replace(" сом", "")}
                    className={diff < 0 ? "text-status-circle" : diff === 0 ? "font-sans font-normal text-fg-faint" : undefined}
                  />
                </button>
              );
            })}
          </div>
        </>
      )}

      {selected && <DaySheet day={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

function Cell({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <span className={cn("num text-right font-bold max-md:text-left", className)}>
      <span className="hidden font-sans text-[11px] font-medium text-fg-faint max-md:block">{label}</span>
      {value}
    </span>
  );
}

function DaySheet({ day, onClose }: { day: BusinessDayResponse; onClose: () => void }) {
  const summaryQuery = useQuery({
    queryKey: ["business-day-summary", day.id],
    queryFn: () => api.businessDaySummary(day.id),
  });
  const summary = summaryQuery.data;
  const diff = discrepancyOf(day);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent tone={diff < 0 ? "circle" : "triangle"}>
        <SheetHeader>
          <SheetTitle>{formatDayLabel(Date.parse(day.opened_at))}</SheetTitle>
          <StateChip tone={diff < 0 ? "circle" : "triangle"}>
            {formatClock(Date.parse(day.opened_at))} → {formatClock(Date.parse(day.closed_at!))}
          </StateChip>
        </SheetHeader>
        <SheetBody>
          <Section title="Наличные">
            <Row label="На начало" value={formatAmount(day.opening_cash)} />
            {summary && <Row label="Пришло за день" value={`+${formatAmount(summary.cash_total)}`} />}
            <Row label="Должно было быть" value={formatAmount(day.expected_cash ?? 0)} />
            <Row label="Насчитали" value={formatAmount(day.counted_cash ?? 0)} />
            <Row
              label="Расхождение"
              value={diff === 0 ? "сошлось" : formatSignedSom(diff)}
              className={diff < 0 ? "text-status-circle" : diff === 0 ? "text-status-triangle" : undefined}
            />
          </Section>
          {summary === undefined ? (
            <div>Загрузка…</div>
          ) : (
            <>
              <Section title="Безнал · сверяется по банку">
                <Row label="QR" value={formatAmount(summary.qr_total)} />
                <Row label="Перевод по номеру" value={formatAmount(summary.transfer_total)} />
              </Section>
              <Section title="Зал">
                <Row label="Сессий" value={String(summary.sessions_count)} />
                <Row label="Часы игры" value={formatHoursMinutes(summary.minutes_total)} />
                <Row label="Бар" value={formatSom(summary.bar_sales_total)} />
              </Section>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="field-label">{title}</h3>
      <dl className="rounded-xl border border-line bg-bg px-3.5 py-1">{children}</dl>
    </section>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-line py-2.5 last:border-b-0">
      <dt className="text-[13.5px] text-fg-muted">{label}</dt>
      <dd className={cn("num text-base font-bold", className)}>{value}</dd>
    </div>
  );
}
```

(Use `import type { ReactNode } from "react"` for `children` if `React` is not in scope.)

In `HallPage.tsx`:
1. Remove the `BusinessDayHistoryDialog` import and its render block, and the `{ kind: "history" }` member of `DialogState`.
2. Add `const [view, setView] = useState<"hall" | "history">("hall");` and `import { HistoryPage } from "./HistoryPage";`.
3. The `История дней` button: `onClick={() => setView("history")}`.
4. Hide the hall header actions and grid while on history: wrap the `h1 Зал` row and the `BusinessDayGuard` block in `view === "hall" ? (…) : <HistoryPage onBack={() => setView("hall")} />`.
5. Hotkeys only on the hall view: `useHallHotkeys(consoles, openConsole, hall?.business_day_open === true && view === "hall");`.

Delete the old dialog and its test:

```bash
git rm web/src/features/hall/BusinessDayHistoryDialog.tsx web/tests/BusinessDayHistoryDialog.test.tsx
```

- [ ] **Step 3: Run everything**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src web/tests
git commit -m "Replace the history dialog with a history page"
```

---

### Task 12: Login and open-day gate

**Files:**
- Modify: `web/src/features/auth/LoginPage.tsx`, `web/src/features/hall/BusinessDayGuard.tsx`
- Index.css: the sleepers styles
- Test: `web/tests/LoginPage.test.tsx` (new), `web/tests/BusinessDayGuard.test.tsx`, `web/tests/HallPage.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (unchanged), `api.openBusinessDay`, `api.businessDayHistory`, `formatDayLabel`, `formatClock`, `formatAmount`, `formatSom`.

**Copy:**
- Login: six light bars (decorative: the consoles «asleep»; they light up one by one while signing in); `PS·клуб`; `Касса клуба. Один пароль на весь клуб.`; label `Пароль`; toggle `Показать` / `Скрыть` (`aria-pressed`); hint `Включён Caps Lock`; errors unchanged (`Неверный пароль` / `Не удалось войти`); button `Войти`.
- Open day: status line `День не открыт` plus ` · прошлый закрыт {dd.mm} в {HH:MM}` when a closed day exists; `h2` `Открыть день`; text `Пересчитайте наличные в кассе и введите сумму. С неё начнётся касса дня.`; label `Наличные на начало`; chip `Как вчера на начало: {N}`; button `Открыть день` / `Открыть день · {N сом}`; small print `Плановые часы — {planned_open}–{planned_close}. День закрывается только вручную.` (from settings when loaded, otherwise omit the hours sentence); error unchanged.

- [ ] **Step 1: Write and update tests (they now fail)**

```tsx
// web/tests/LoginPage.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "@/features/auth/LoginPage";

function renderLogin() {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ authenticated: false }) })));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LoginPage />
    </QueryClientProvider>,
  );
}

describe("LoginPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps Войти disabled until a password is typed", () => {
    renderLogin();
    expect(screen.getByRole("button", { name: "Войти" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "x" } });
    expect(screen.getByRole("button", { name: "Войти" })).toBeEnabled();
  });

  it("shows and hides the password", () => {
    renderLogin();
    const input = screen.getByLabelText("Пароль");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Показать" }));
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Скрыть" })).toHaveAttribute("aria-pressed", "true");
  });

  it("warns about Caps Lock", () => {
    renderLogin();
    fireEvent.keyUp(screen.getByLabelText("Пароль"), { key: "A", modifierCapsLock: true });
    expect(screen.getByText("Включён Caps Lock")).toBeInTheDocument();
  });
});
```

`web/tests/BusinessDayGuard.test.tsx`: the guard now also reads the history and the settings, so replace each `vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) })` with a URL-routing mock:

```tsx
function routedFetch(openResult: { ok: boolean; status?: number; json: () => Promise<unknown> } = { ok: true, json: async () => ({ id: 1 }) }) {
  return vi.fn(async (url: string) => {
    if (url === "/api/business-days?limit=30") {
      return {
        ok: true,
        json: async () => [
          { id: 1, opened_at: "2026-09-29T04:04:00Z", closed_at: "2026-09-29T22:51:00Z", opening_cash: 2000, expected_cash: 6120, counted_cash: 6070 },
        ],
      };
    }
    if (url === "/api/settings") {
      return { ok: true, json: async () => ({ grace_minutes: 3, warn_minutes: 5, planned_open: "10:00", planned_close: "05:00" }) };
    }
    return openResult;
  });
}
```

(For the failure test, pass `{ ok: false, status: 500, json: async () => ({ detail: "boom" }) }` as `openResult`, keeping whatever the test used before.)

| Old | New |
|---|---|
| `getByText("День не открыт. Открыть?")` | `getByRole("heading", { name: "Открыть день" })` |
| `getByRole("button", { name: "Открыть" })` (all) | `getByRole("button", { name: /^Открыть день/ })` |

Add:

```tsx
  it("remembers yesterday's opening cash as a one-tap suggestion", async () => {
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BusinessDayGuard businessDayOpen={false}>
          <div>Зал</div>
        </BusinessDayGuard>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/прошлый закрыт 30\.09 в 04:51/)).toBeInTheDocument();
    // Accessible names keep the non-breaking thousands space, so match it with \s.
    fireEvent.click(screen.getByRole("button", { name: /^Как вчера на начало: 2\s000$/ }));
    expect(screen.getByLabelText("Наличные на начало")).toHaveValue(2000);
    expect(screen.getByRole("button", { name: /^Открыть день · 2\s000 сом$/ })).toBeEnabled();
  });
```

`web/tests/HallPage.test.tsx`:
- In `stubApi`, before the final fallback, add `if (url === "/api/business-days?limit=30") return { ok: true, json: async () => [] };`.
- `getByText("День не открыт. Открыть?")` / `queryByText("День не открыт. Открыть?")` → `getByRole("heading", { name: "Открыть день" })` / `queryByRole("heading", { name: "Открыть день" })`.

Run: `npm test -- tests/LoginPage.test.tsx tests/BusinessDayGuard.test.tsx tests/HallPage.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement**

Append inside `@layer components` in `web/src/index.css`:

```css
  .sleepers {
    @apply flex gap-2;
  }
  .sleepers > i {
    @apply h-1 flex-1 rounded-b-[3px] bg-status-idle transition-[background-color,box-shadow] duration-300;
  }
  .sleepers[data-waking="true"] > i {
    background: hsl(var(--cross));
    box-shadow: 0 0 12px hsl(var(--cross));
  }
  .sleepers[data-waking="true"] > i:nth-child(2) { transition-delay: 80ms; }
  .sleepers[data-waking="true"] > i:nth-child(3) { transition-delay: 160ms; }
  .sleepers[data-waking="true"] > i:nth-child(4) { transition-delay: 240ms; }
  .sleepers[data-waking="true"] > i:nth-child(5) { transition-delay: 320ms; }
  .sleepers[data-waking="true"] > i:nth-child(6) { transition-delay: 400ms; }
  .gate-card {
    @apply grid w-full max-w-[420px] gap-[18px] rounded-2xl border border-line bg-surface p-7 shadow-[var(--shadow-lg)] max-sm:p-[22px];
  }
```

Replace `web/src/features/auth/LoginPage.tsx` entirely:

```tsx
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { useAuth } from "./useAuth";

export function LoginPage() {
  const { login, loginError } = useAuth();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await login(password);
    } catch {
      // error already surfaces via loginError
    } finally {
      setSubmitting(false);
    }
  }

  const trackCapsLock = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState("CapsLock"));

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <form onSubmit={handleSubmit} className="gate-card">
        {/* The six consoles, asleep; they light up one by one while signing in. */}
        <div aria-hidden className="sleepers" data-waking={submitting}>
          <i /><i /><i /><i /><i /><i />
        </div>
        <div>
          <h1 className="font-display text-[34px] font-extrabold tracking-tight">
            PS<span className="font-medium text-fg-muted">·клуб</span>
          </h1>
          <p className="text-sm text-fg-muted">Касса клуба. Один пароль на весь клуб.</p>
        </div>
        <div>
          <label htmlFor="password" className="field-label">
            Пароль
          </label>
          <div className="relative">
            <Input
              id="password"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              className="num h-12 pr-[104px] text-xl"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyUp={trackCapsLock}
              onKeyDown={trackCapsLock}
              autoFocus
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-1.5 top-1.5"
              aria-pressed={visible}
              onClick={() => setVisible((value) => !value)}
            >
              {visible ? "Скрыть" : "Показать"}
            </Button>
          </div>
          {capsLock && <p className="mt-2 text-[13.5px] text-status-amber-text">Включён Caps Lock</p>}
          {loginError && (
            <p role="alert" className="mt-2 text-[13.5px] text-status-circle">
              {loginError instanceof ApiError && loginError.status === 401 ? "Неверный пароль" : "Не удалось войти"}
            </p>
          )}
        </div>
        <Button type="submit" size="lg" disabled={submitting || password.length === 0}>
          Войти
        </Button>
      </form>
    </div>
  );
}
```

Replace `web/src/features/hall/BusinessDayGuard.tsx` entirely:

```tsx
import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatClock, formatDayLabel } from "@/lib/bishkek";
import { formatAmount, formatSom } from "@/lib/format";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

interface BusinessDayGuardProps {
  businessDayOpen: boolean;
  children: ReactNode;
}

export function BusinessDayGuard({ businessDayOpen, children }: BusinessDayGuardProps) {
  const [openingCash, setOpeningCash] = useState("");
  const queryClient = useQueryClient();
  const historyQuery = useQuery({
    queryKey: ["business-day-history"],
    queryFn: api.businessDayHistory,
    enabled: !businessDayOpen,
  });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings, enabled: !businessDayOpen });

  const openMutation = useMutation({
    mutationFn: () => api.openBusinessDay(Number(openingCash)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY }),
  });

  if (businessDayOpen) return <>{children}</>;

  const lastClosed = (historyQuery.data ?? [])
    .filter((day) => day.closed_at !== null)
    .sort((a, b) => Date.parse(b.closed_at!) - Date.parse(a.closed_at!))[0];
  const openingCashValue = Number(openingCash);
  const isValidOpeningCash = openingCash.trim().length > 0 && Number.isFinite(openingCashValue) && openingCashValue >= 0;
  const settings = settingsQuery.data;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isValidOpeningCash) openMutation.mutate();
  }

  return (
    <div className="grid min-h-[60vh] place-items-center p-4">
      <form onSubmit={handleSubmit} className="gate-card">
        <div className="flex items-center gap-2 text-[13px] text-fg-muted">
          <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-status-idle" />
          День не открыт
          {lastClosed && (
            <>
              {" "}
              · прошлый закрыт {formatDayLabel(Date.parse(lastClosed.closed_at!)).slice(4)} в {formatClock(Date.parse(lastClosed.closed_at!))}
            </>
          )}
        </div>
        <div>
          <h2 className="font-display text-2xl font-extrabold tracking-tight">Открыть день</h2>
          <p className="mt-1.5 text-sm text-fg-muted">Пересчитайте наличные в кассе и введите сумму. С неё начнётся касса дня.</p>
        </div>
        <div>
          <label htmlFor="opening-cash" className="field-label">
            Наличные на начало
          </label>
          <Input
            id="opening-cash"
            type="number"
            min="0"
            inputMode="numeric"
            className="num h-12 text-xl"
            placeholder="0"
            value={openingCash}
            onChange={(event) => setOpeningCash(event.target.value)}
            autoFocus
          />
          {lastClosed && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setOpeningCash(String(lastClosed.opening_cash))}
                className="h-[30px] rounded-full border border-line px-3 text-[13px] text-fg-muted hover:border-hover-line hover:text-fg"
              >
                Как вчера на начало: {formatAmount(lastClosed.opening_cash)}
              </button>
            </div>
          )}
        </div>
        <Button type="submit" size="lg" disabled={!isValidOpeningCash || openMutation.isPending}>
          Открыть день{isValidOpeningCash ? ` · ${formatSom(openingCashValue)}` : ""}
        </Button>
        {openMutation.isError && (
          <p role="alert" className="text-sm text-status-circle">
            Не удалось открыть день. Попробуйте ещё раз.
          </p>
        )}
        <p className="text-[12.5px] text-fg-faint">
          {settings ? `Плановые часы — ${settings.planned_open}–${settings.planned_close}. ` : ""}День закрывается только вручную.
        </p>
      </form>
    </div>
  );
}
```

`formatDayLabel(...).slice(4)` turns `"ср, 30.09"` into `"30.09"`. If the implementer prefers, add a `formatDate(ms)` (`"30.09"`) to `lib/bishkek.ts` with a test and use it here instead; either is fine.

- [ ] **Step 3: Run everything**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src web/tests
git commit -m "Redesign the login and open-day screens"
```

---

## Part 2 — the concept features that need backend data

Requested by the owner on 2026-09-30 after Part 1 was planned. The owner asked for these features explicitly, so they reverse two earlier decisions:
- the Stage 4 plan's "no product categories";
- Part 1's "no backend changes".

Tasks 13–16 change the backend. Task 17 regenerates the frontend types. Tasks 17–20 build the UI on top.

Backend commands, from the repo root: `uv run pytest <paths> -v`, `uv run ruff check .`, `uv run alembic revision --autogenerate -m "<message>"`, `uv run alembic upgrade head`. Tests need the test database on port 5433 (see `tests/conftest.py`).

---

### Task 13: Day totals in the history list, free minutes in the API

`day_summary` already computes `free_minutes_total` (the Telegram summary prints it), but the API drops it. The history list needs every day's totals; calling `day_summary` per row would cost one round-trip per day, so the computation is batched and `day_summary` becomes a one-day call of the batch.

**Files:**
- Modify: `core/services/business_days.py`, `core/api/schemas/business_days.py`, `core/api/routes/business_days.py`
- Test: `tests/services/test_business_days.py`, `tests/api/test_business_days.py`

**Interfaces:**
- Produces: `summaries_for_days(db, *, days: list[BusinessDay], now: datetime) -> dict[int, DaySummary]`; `day_summary` keeps its signature and behaviour.
- Produces (API): `BusinessDaySummaryResponse.free_minutes_total: int`. `GET /api/business-days` now returns `list[BusinessDayHistoryItem]`, which is `BusinessDayResponse` plus `cash_total`, `qr_total`, `transfer_total`, `sessions_count`, `minutes_total`, `free_minutes_total`, `bar_sales_total` (all `int`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/services/test_business_days.py` (add `summaries_for_days` to the import from `core.services.business_days`):

```python
async def test_summaries_for_days_keeps_each_day_apart(db_session):
    first = await open_business_day(db_session, opening_cash=1000, now=T)
    session_id = await _make_finished_session(db_session, first.id)
    db_session.add_all(
        [
            Payment(session_id=session_id, business_day_id=first.id, amount=300, method=PaymentMethod.cash, created_at=T),
            Payment(session_id=session_id, business_day_id=first.id, amount=200, method=PaymentMethod.qr, created_at=T),
        ]
    )
    await db_session.commit()
    await close_business_day(db_session, business_day_id=first.id, counted_cash=1300, now=T + timedelta(hours=10))

    second = await open_business_day(db_session, opening_cash=2000, now=T + timedelta(days=1))
    # A late payment for yesterday's session lands in the day it was taken (SPEC §3.4).
    db_session.add(
        Payment(session_id=session_id, business_day_id=second.id, amount=150, method=PaymentMethod.transfer, created_at=T + timedelta(days=1))
    )
    await db_session.commit()

    now = T + timedelta(days=1, hours=2)
    summaries = await summaries_for_days(db_session, days=[first, second], now=now)

    assert summaries[first.id] == await day_summary(db_session, business_day_id=first.id, now=now)
    assert (summaries[first.id].cash_total, summaries[first.id].qr_total, summaries[first.id].transfer_total) == (300, 200, 0)
    assert summaries[first.id].sessions_count == 1
    assert (summaries[second.id].cash_total, summaries[second.id].transfer_total) == (0, 150)
    assert summaries[second.id].expected_cash == 2000
    assert summaries[second.id].sessions_count == 0


async def test_summaries_for_days_of_nothing_is_empty(db_session):
    assert await summaries_for_days(db_session, days=[], now=T) == {}
```

Append to `tests/api/test_business_days.py`:

```python
async def test_history_list_carries_each_days_totals(client):
    opened = await client.post("/api/business-days/open", json={"opening_cash": 1000})
    assert opened.status_code == 200

    response = await client.get("/api/business-days")
    assert response.status_code == 200
    [day] = response.json()
    assert day["opening_cash"] == 1000
    for key in ("cash_total", "qr_total", "transfer_total", "sessions_count", "minutes_total", "free_minutes_total", "bar_sales_total"):
        assert day[key] == 0


async def test_summary_exposes_free_minutes(client):
    day = (await client.post("/api/business-days/open", json={"opening_cash": 0})).json()
    summary = (await client.get(f"/api/business-days/{day['id']}/summary")).json()
    assert summary["free_minutes_total"] == 0
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run pytest tests/services/test_business_days.py tests/api/test_business_days.py -v`
Expected: FAIL — `summaries_for_days` is missing, and the new keys are absent.

- [ ] **Step 3: Implement**

In `core/services/business_days.py`, replace `day_summary` with:

```python
async def summaries_for_days(
    db: AsyncSession, *, days: list[BusinessDay], now: datetime
) -> dict[int, DaySummary]:
    """Summaries for several days in a fixed number of queries: the history list shows
    every day's totals, and one day_summary() per row would be one round-trip per day."""
    if not days:
        return {}
    day_ids = [day.id for day in days]

    payments_result = await db.execute(
        select(Payment.business_day_id, Payment.method, Payment.amount).where(
            Payment.business_day_id.in_(day_ids)
        )
    )
    paid: dict[int, dict[PaymentMethod, int]] = {
        day_id: {method: 0 for method in PaymentMethod} for day_id in day_ids
    }
    for day_id, method, amount in payments_result.all():
        paid[day_id][method] += amount

    sessions_result = await db.execute(
        select(SessionModel).where(
            SessionModel.business_day_id.in_(day_ids),
            SessionModel.status != SessionStatus.cancelled,
        )
    )
    # Session.segments and Session.orders are lazy="selectin" (core/db/models/sessions.py):
    # they are loaded in bulk with this query, not one per session.
    sessions_by_day: dict[int, list[SessionModel]] = {day_id: [] for day_id in day_ids}
    for session in sessions_result.scalars().all():
        sessions_by_day[session.business_day_id].append(session)

    summaries: dict[int, DaySummary] = {}
    for day in days:
        minutes_total = free_minutes_total = bar_sales_total = 0
        has_active = False
        for session in sessions_by_day[day.id]:
            if session.status == SessionStatus.active:
                has_active = True
            session_minutes = 0
            for segment in session.segments:
                end = segment.ends_at or now
                session_minutes += int((end - segment.starts_at).total_seconds() // 60)
            minutes_total += session_minutes
            if session.kind != SessionKind.paid:
                free_minutes_total += session_minutes
            for order in session.orders:
                bar_sales_total += order.qty * order.unit_price

        cash_total = paid[day.id][PaymentMethod.cash]
        summaries[day.id] = DaySummary(
            opening_cash=day.opening_cash,
            cash_total=cash_total,
            qr_total=paid[day.id][PaymentMethod.qr],
            transfer_total=paid[day.id][PaymentMethod.transfer],
            expected_cash=day.opening_cash + cash_total,
            sessions_count=len(sessions_by_day[day.id]),
            minutes_total=minutes_total,
            free_minutes_total=free_minutes_total,
            bar_sales_total=bar_sales_total,
            has_active_sessions=has_active,
        )
    return summaries


async def day_summary(db: AsyncSession, *, business_day_id: int, now: datetime) -> DaySummary:
    day = await db.get(BusinessDay, business_day_id)
    if day is None:
        raise NotFoundError(f"business day {business_day_id} not found")
    return (await summaries_for_days(db, days=[day], now=now))[day.id]
```

In `core/api/schemas/business_days.py`, add `free_minutes_total: int` to `BusinessDaySummaryResponse` (after `minutes_total`), and add:

```python
class BusinessDayHistoryItem(BusinessDayResponse):
    """A day in the history list, with its totals. Cash and non-cash stay apart
    (CLAUDE.md rule 10)."""

    cash_total: int
    qr_total: int
    transfer_total: int
    sessions_count: int
    minutes_total: int
    free_minutes_total: int
    bar_sales_total: int
```

In `core/api/routes/business_days.py`, import `BusinessDayHistoryItem` and replace `list_days`:

```python
@router.get("", response_model=list[BusinessDayHistoryItem])
async def list_days(
    limit: int = Query(30, ge=1, le=365), db: AsyncSession = Depends(get_session)  # noqa: B008
):
    days = await business_days.list_business_days(db, limit=limit)
    summaries = await business_days.summaries_for_days(db, days=days, now=_now())
    items = []
    for day in days:
        summary = summaries[day.id]
        items.append(
            BusinessDayHistoryItem(
                **BusinessDayResponse.model_validate(day).model_dump(),
                cash_total=summary.cash_total,
                qr_total=summary.qr_total,
                transfer_total=summary.transfer_total,
                sessions_count=summary.sessions_count,
                minutes_total=summary.minutes_total,
                free_minutes_total=summary.free_minutes_total,
                bar_sales_total=summary.bar_sales_total,
            )
        )
    return items
```

- [ ] **Step 4: Run the backend suite**

Run: `uv run pytest -q && uv run ruff check .`
Expected: all PASS. The bot's day-close summary is unchanged because `day_summary` returns the same `DaySummary`.

- [ ] **Step 5: Commit**

```bash
git add core tests
git commit -m "Batch day summaries and return totals with the history list"
```

---

### Task 14: How long a free console has been idle

**Files:**
- Modify: `core/services/hall.py`, `core/api/schemas/hall.py`
- Test: `tests/services/test_hall_free_since.py` (new)

**Interfaces:**
- Produces: `ConsoleHallView.free_since: datetime | None = None` (last field, with a default, so existing constructions such as `tests/test_telegram_messages.py` stay valid), and `HallConsoleResponse.free_since: datetime | None = None`.
- Rule: `None` while the console has an active session or no day is open. Otherwise it is the later of the console's last `ended_at` and the open day's `opened_at`, because the hours the club was closed are not idle time.

- [ ] **Step 1: Write the failing test**

```python
# tests/services/test_hall_free_since.py
from datetime import UTC, datetime, timedelta

from core.db.models import BusinessDay, Console, Session, SessionKind, SessionStatus, Zone
from core.services.hall import build_hall_snapshot

T = datetime(2026, 9, 29, 4, 0, 0, tzinfo=UTC)  # 10:00 in Bishkek


async def _console(db_session, zone_id: int, name: str) -> Console:
    console = Console(zone_id=zone_id, name=name)
    db_session.add(console)
    await db_session.flush()
    return console


async def test_free_since_counts_from_the_last_session_but_not_before_the_day(db_session):
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    used_today = await _console(db_session, zone.id, "PS 1")
    never_used = await _console(db_session, zone.id, "PS 2")
    used_yesterday = await _console(db_session, zone.id, "PS 3")
    busy = await _console(db_session, zone.id, "PS 4")

    yesterday = BusinessDay(opened_at=T - timedelta(days=1), closed_at=T - timedelta(hours=5), opening_cash=0)
    today = BusinessDay(opened_at=T, opening_cash=0)
    db_session.add_all([yesterday, today])
    await db_session.flush()

    def session(console: Console, day: BusinessDay, *, started: datetime, ended: datetime | None) -> Session:
        return Session(
            console_id=console.id,
            business_day_id=day.id,
            kind=SessionKind.paid,
            status=SessionStatus.active if ended is None else SessionStatus.finished,
            started_at=started,
            grace_until=started,
            ended_at=ended,
        )

    db_session.add_all(
        [
            session(used_today, today, started=T + timedelta(minutes=30), ended=T + timedelta(hours=2)),
            session(used_yesterday, yesterday, started=T - timedelta(hours=8), ended=T - timedelta(hours=6)),
            session(busy, today, started=T + timedelta(hours=1), ended=None),
        ]
    )
    await db_session.commit()

    snapshot = await build_hall_snapshot(db_session, T + timedelta(hours=3))
    free_since = {view.name: view.free_since for view in snapshot.consoles}

    assert free_since["PS 1"] == T + timedelta(hours=2)
    assert free_since["PS 2"] == T
    assert free_since["PS 3"] == T  # yesterday's end is before today opened
    assert free_since["PS 4"] is None


async def test_free_since_is_empty_while_no_day_is_open(db_session):
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    await _console(db_session, zone.id, "PS 1")
    await db_session.commit()

    snapshot = await build_hall_snapshot(db_session, T)
    assert snapshot.consoles[0].free_since is None
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest tests/services/test_hall_free_since.py -v`
Expected: FAIL — `ConsoleHallView` has no `free_since`.

- [ ] **Step 3: Implement**

In `core/services/hall.py`:
- Import `func` from `sqlalchemy`.
- Add the field `free_since: datetime | None = None` as the **last** field of `ConsoleHallView`.
- In `build_hall_snapshot`, move `day = await business_days.get_open_business_day(db)` to the top of the function, then compute the last end per console:

```python
    day = await business_days.get_open_business_day(db)

    last_ended: dict[int, datetime] = {}
    if day is not None:
        ended_result = await db.execute(
            select(SessionModel.console_id, func.max(SessionModel.ended_at))
            .where(SessionModel.console_id.is_not(None), SessionModel.ended_at.is_not(None))
            .group_by(SessionModel.console_id)
        )
        last_ended = {console_id: ended_at for console_id, ended_at in ended_result.all()}
```

- In the console loop, before building the view:

```python
        free_since = None
        if session is None and day is not None:
            # Idle time runs from the last session's end, but never from before the day
            # opened: the hours the club was closed are not "простой".
            last = last_ended.get(console.id)
            free_since = max(last, day.opened_at) if last is not None else day.opened_at
```

and pass `free_since=free_since` to `ConsoleHallView(...)`. The final `HallSnapshot(...)` keeps using `day`; remove the old second lookup.

In `core/api/schemas/hall.py`, add `free_since: datetime | None = None` to `HallConsoleResponse` (last field), and pass `free_since=view.free_since` in `hall_snapshot_to_response`.

- [ ] **Step 4: Run the backend suite**

Run: `uv run pytest -q && uv run ruff check .`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add core tests
git commit -m "Report when each free console became idle"
```

---

### Task 15: The day's event feed

The feed is the digital version of the notebook. It is built only from rows that already carry timestamps, so nothing is stored twice. The one timestamp missing is when an extension was sold (`session_segments` has no creation time, and an open segment queued behind a package *starts* in the future), so this task adds `session_segments.created_at`.

**Files:**
- Modify: `core/db/models/sessions.py`, `core/services/sessions.py`
- Create: migration via autogenerate, `core/services/feed.py`, `core/api/schemas/feed.py`
- Modify: `core/api/routes/business_days.py`
- Test: `tests/services/test_feed.py` (new), `tests/api/test_business_days.py`

**Interfaces:**
- Produces: `SessionSegment.created_at: datetime | None`. `NULL` on rows created before this migration; set to `now` by `start_session` and `extend_session`.
- Produces: `FeedKind` (`session_started`, `session_extended`, `session_finished`, `session_cancelled`, `payment`, `order`).
- Produces: `FeedEvent(at, kind, session_id, console_name: str | None, session_kind, segment_kind=None, tariff_name=None, reason=None, product_name=None, qty=None, amount=None, method=None, minutes=None)`.
- Produces: `day_feed(db, *, business_day_id: int, limit: int = 200) -> list[FeedEvent]`, newest first.
- Produces (API): `GET /api/business-days/{id}/feed?limit=200` → `list[FeedEventResponse]`, and 404 for an unknown day.
- What is in a day's feed: sessions of that day starting; sessions ending, segments sold and orders placed within `[opened_at, closed_at or now]`; payments with that `business_day_id`. A walk-in ticket gets no «started» event, because its orders and payment tell its story. `console_name` is `None` for a ticket.

- [ ] **Step 1: Write the failing tests**

```python
# tests/services/test_feed.py
from datetime import UTC, datetime, timedelta

import pytest

from core.db.models import (
    Console,
    PaymentMethod,
    Product,
    SegmentKind,
    SessionKind,
    Tariff,
    TariffKind,
    Zone,
)
from core.services.bar import add_order
from core.services.business_days import close_business_day, open_business_day
from core.services.errors import NotFoundError
from core.services.feed import FeedKind, day_feed
from core.services.payments import add_payment
from core.services.sessions import extend_session, start_session, stop_session

T = datetime(2026, 9, 29, 4, 0, 0, tzinfo=UTC)


async def _hall(db_session):
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    console = Console(zone_id=zone.id, name="PS 1")
    three_hours = Tariff(zone_id=zone.id, kind=TariffKind.package, name="3 часа", duration_min=180, price=400)
    one_hour = Tariff(zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150)
    cola = Product(name="Кола", price=60, is_active=True)
    db_session.add_all([console, three_hours, one_hour, cola])
    await db_session.commit()
    return console, three_hours, one_hour, cola


async def test_feed_tells_the_day_newest_first(db_session):
    console, three_hours, one_hour, cola = await _hall(db_session)
    day = await open_business_day(db_session, opening_cash=0, now=T)

    session = await start_session(
        db_session, console_id=console.id, kind=SessionKind.paid, tariff_id=three_hours.id,
        reason=None, comment=None, now=T + timedelta(minutes=1),
    )
    await add_order(db_session, session_id=session.id, product_id=cola.id, qty=2, now=T + timedelta(minutes=30))
    await extend_session(db_session, session_id=session.id, tariff_id=one_hour.id, now=T + timedelta(hours=2))
    await add_payment(db_session, session_id=session.id, amount=670, method=PaymentMethod.qr, now=T + timedelta(hours=3))
    await stop_session(db_session, session_id=session.id, now=T + timedelta(hours=4))

    events = await day_feed(db_session, business_day_id=day.id)

    assert [e.kind for e in events] == [
        FeedKind.session_finished,
        FeedKind.payment,
        FeedKind.session_extended,
        FeedKind.order,
        FeedKind.session_started,
    ]
    finished, payment, extended, order, started = events
    assert all(e.console_name == "PS 1" and e.session_id == session.id for e in events)
    assert (started.segment_kind, started.tariff_name) == (SegmentKind.package, "3 часа")
    assert (order.product_name, order.qty, order.amount) == ("Кола", 2, 120)
    assert (extended.tariff_name, extended.at) == ("1 час", T + timedelta(hours=2))
    assert (payment.amount, payment.method) == (670, PaymentMethod.qr)
    assert finished.minutes == 239


async def test_feed_leaves_out_other_days(db_session):
    console, three_hours, _, _ = await _hall(db_session)
    first = await open_business_day(db_session, opening_cash=0, now=T)
    session = await start_session(
        db_session, console_id=console.id, kind=SessionKind.paid, tariff_id=three_hours.id,
        reason=None, comment=None, now=T + timedelta(minutes=1),
    )
    await stop_session(db_session, session_id=session.id, now=T + timedelta(hours=1))
    await close_business_day(db_session, business_day_id=first.id, counted_cash=0, now=T + timedelta(hours=2))

    second = await open_business_day(db_session, opening_cash=0, now=T + timedelta(days=1))
    assert await day_feed(db_session, business_day_id=second.id) == []


async def test_feed_of_an_unknown_day_is_not_found(db_session):
    with pytest.raises(NotFoundError):
        await day_feed(db_session, business_day_id=999)
```

Append to `tests/api/test_business_days.py`:

```python
async def test_day_feed_endpoint(client):
    day = (await client.post("/api/business-days/open", json={"opening_cash": 0})).json()
    response = await client.get(f"/api/business-days/{day['id']}/feed")
    assert response.status_code == 200
    assert response.json() == []
    assert (await client.get("/api/business-days/999/feed")).status_code == 404
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run pytest tests/services/test_feed.py tests/api/test_business_days.py -v`
Expected: FAIL — `core.services.feed` does not exist.

- [ ] **Step 3: Segment creation time**

In `core/db/models/sessions.py`, add to `SessionSegment`:

```python
    # When the operator sold this segment. An open segment queued behind a package
    # *starts* in the future, so starts_at cannot tell when an extension happened.
    # NULL on rows created before this column existed.
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
```

Run: `uv run alembic revision --autogenerate -m "add session_segments created_at"`
Expected: a new file under `core/db/alembic/versions/` whose `upgrade()` is `op.add_column('session_segments', sa.Column('created_at', sa.DateTime(timezone=True), nullable=True))` and whose `downgrade()` drops it. Review it and delete anything else autogenerate added.

Run: `uv run alembic upgrade head`

In `core/services/sessions.py`:
- `_new_segment_from_tariff(tariff, *, starts_at, created_at)`: pass `created_at=created_at` into both `SessionSegment(...)` constructions.
- `start_session`: call `_new_segment_from_tariff(tariff, starts_at=grace_until, created_at=now)`, and add `created_at=now` to the free/service `SessionSegment(...)`.
- `extend_session`: call `_new_segment_from_tariff(tariff, starts_at=start, created_at=now)`.

- [ ] **Step 4: The feed service, schema and route**

```python
# core/services/feed.py
import enum
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import (
    BusinessDay,
    Console,
    Order,
    Payment,
    PaymentMethod,
    Product,
    SegmentKind,
    SessionKind,
    SessionSegment,
    SessionStatus,
    Tariff,
)
from core.db.models import Session as SessionModel
from core.services.errors import NotFoundError


class FeedKind(str, enum.Enum):
    session_started = "session_started"
    session_extended = "session_extended"
    session_finished = "session_finished"
    session_cancelled = "session_cancelled"
    payment = "payment"
    order = "order"


@dataclass(frozen=True)
class FeedEvent:
    at: datetime
    kind: FeedKind
    session_id: int
    console_name: str | None  # None for a walk-in ticket
    session_kind: SessionKind
    segment_kind: SegmentKind | None = None
    tariff_name: str | None = None
    reason: str | None = None
    product_name: str | None = None
    qty: int | None = None
    amount: int | None = None
    method: PaymentMethod | None = None
    minutes: int | None = None


async def day_feed(db: AsyncSession, *, business_day_id: int, limit: int = 200) -> list[FeedEvent]:
    """The day's events, newest first: the digital version of the paper notebook.
    Built from rows that already carry timestamps; nothing is stored twice."""
    day = await db.get(BusinessDay, business_day_id)
    if day is None:
        raise NotFoundError(f"business day {business_day_id} not found")

    def within_day(column):
        if day.closed_at is None:
            return column >= day.opened_at
        return and_(column >= day.opened_at, column <= day.closed_at)

    console_names = {c.id: c.name for c in (await db.execute(select(Console))).scalars().all()}
    tariff_names = {t.id: t.name for t in (await db.execute(select(Tariff))).scalars().all()}

    def who(session: SessionModel) -> dict:
        return {
            "session_id": session.id,
            "console_name": console_names.get(session.console_id) if session.console_id else None,
            "session_kind": session.kind,
        }

    events: list[FeedEvent] = []

    started = await db.execute(
        select(SessionModel).where(
            SessionModel.business_day_id == day.id, SessionModel.console_id.is_not(None)
        )
    )
    for session in started.scalars().all():
        first = session.segments[0] if session.segments else None
        events.append(
            FeedEvent(
                at=session.started_at,
                kind=FeedKind.session_started,
                segment_kind=first.kind if first else None,
                tariff_name=tariff_names.get(first.tariff_id) if first and first.tariff_id else None,
                reason=session.reason,
                **who(session),
            )
        )

    ended = await db.execute(select(SessionModel).where(within_day(SessionModel.ended_at)))
    for session in ended.scalars().all():
        events.append(
            FeedEvent(
                at=session.ended_at,
                kind=(
                    FeedKind.session_cancelled
                    if session.status == SessionStatus.cancelled
                    else FeedKind.session_finished
                ),
                minutes=int((session.ended_at - session.started_at).total_seconds() // 60),
                **who(session),
            )
        )

    sold = await db.execute(
        select(SessionSegment, SessionModel)
        .join(SessionModel, SessionSegment.session_id == SessionModel.id)
        .where(within_day(SessionSegment.created_at))
    )
    for segment, session in sold.all():
        if segment.id == min(s.id for s in session.segments):
            continue  # the first segment is the start, already listed
        events.append(
            FeedEvent(
                at=segment.created_at,
                kind=FeedKind.session_extended,
                segment_kind=segment.kind,
                tariff_name=tariff_names.get(segment.tariff_id) if segment.tariff_id else None,
                **who(session),
            )
        )

    payments = await db.execute(
        select(Payment, SessionModel)
        .join(SessionModel, Payment.session_id == SessionModel.id)
        .where(Payment.business_day_id == day.id)
    )
    for payment, session in payments.all():
        events.append(
            FeedEvent(
                at=payment.created_at,
                kind=FeedKind.payment,
                amount=payment.amount,
                method=payment.method,
                **who(session),
            )
        )

    orders = await db.execute(
        select(Order, SessionModel, Product)
        .join(SessionModel, Order.session_id == SessionModel.id)
        .join(Product, Order.product_id == Product.id)
        .where(within_day(Order.created_at))
    )
    for order, session, product in orders.all():
        events.append(
            FeedEvent(
                at=order.created_at,
                kind=FeedKind.order,
                product_name=product.name,
                qty=order.qty,
                amount=order.qty * order.unit_price,
                **who(session),
            )
        )

    events.sort(key=lambda event: event.at, reverse=True)
    return events[:limit]
```

```python
# core/api/schemas/feed.py
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from core.db.models import PaymentMethod, SegmentKind, SessionKind
from core.services.feed import FeedKind


class FeedEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    at: datetime
    kind: FeedKind
    session_id: int
    console_name: str | None
    session_kind: SessionKind
    segment_kind: SegmentKind | None
    tariff_name: str | None
    reason: str | None
    product_name: str | None
    qty: int | None
    amount: int | None
    method: PaymentMethod | None
    minutes: int | None
```

In `core/api/routes/business_days.py` (imports `feed as feed_service` from `core.services` and `FeedEventResponse` from `core.api.schemas.feed`):

```python
@router.get("/{business_day_id}/feed", response_model=list[FeedEventResponse])
async def business_day_feed(
    business_day_id: int,
    limit: int = Query(200, ge=1, le=500),
    db: AsyncSession = Depends(get_session),  # noqa: B008
):
    return await feed_service.day_feed(db, business_day_id=business_day_id, limit=limit)
```

- [ ] **Step 5: Run the backend suite**

Run: `uv run pytest -q && uv run ruff check .`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add core tests
git commit -m "Add the day's event feed and record when segments are sold"
```

---

### Task 16: Product categories

A free-text category set in SQLAdmin. The bar shows category tabs only when the catalog has at least two groups. It is free text rather than an enum because the owner names the groups; the frontend groups by exact value, so keep the spelling consistent in the admin.

**Files:**
- Modify: `core/db/models/bar.py`, `core/api/schemas/bar.py`, `core/api/admin.py`
- Create: migration via autogenerate
- Test: `tests/api/test_bar.py`

**Interfaces:**
- Produces: `Product.category: str | None` (`String(40)`) and `ProductResponse.category: str | None = None`.

- [ ] **Step 1: Write the failing test**

Append to `tests/api/test_bar.py`. It inserts products through its own engine, the same way the file's `_seed` helper does:

```python
async def test_products_carry_their_category(client):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.models import Product

    engine = create_async_engine(TEST_DATABASE_URL)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        db.add_all(
            [
                Product(name="Кола", price=60, is_active=True, category="Напитки"),
                Product(name="Сникерс", price=70, is_active=True),
            ]
        )
        await db.commit()
    await engine.dispose()

    products = (await client.get("/api/products")).json()
    assert {p["name"]: p["category"] for p in products} == {"Кола": "Напитки", "Сникерс": None}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest tests/api/test_bar.py -v`
Expected: FAIL — `Product` has no `category`.

- [ ] **Step 3: Implement**

In `core/db/models/bar.py`, add to `Product`:

```python
    # Free text set in SQLAdmin ("Напитки", "Еда", "Снеки"); the bar shows a tab per value.
    category: Mapped[str | None] = mapped_column(String(40), default=None)
```

Run: `uv run alembic revision --autogenerate -m "add products category"`. Check that the generated file only adds (and drops, in downgrade) `products.category` as `sa.String(length=40), nullable=True`.

Run: `uv run alembic upgrade head`

In `core/api/schemas/bar.py`, add `category: str | None = None` to `ProductResponse`.

In `core/api/admin.py`:

```python
class ProductAdmin(ModelView, model=Product):
    column_list = [Product.id, Product.name, Product.category, Product.price, Product.is_active]
    can_delete = False
```

- [ ] **Step 4: Run the backend suite**

Run: `uv run pytest -q && uv run ruff check .`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add core tests
git commit -m "Add a category to bar products"
```

---

### Task 17: Frontend types; history totals and free hours

**Files:**
- Modify: `web/src/types/api.ts` (regenerated), `web/src/lib/api.ts`, `web/src/features/hall/HistoryPage.tsx`
- Test: `web/tests/HistoryPage.test.tsx`, `web/tests/HallPage.test.tsx`

**Interfaces:**
- Produces (`lib/api.ts`): `BusinessDayHistoryItem`, `FeedEventResponse`, `FeedKind` types; `api.businessDayHistory(): Promise<BusinessDayHistoryItem[]>`; `api.businessDayFeed(id: number): Promise<FeedEventResponse[]>`.

**Copy:**
- History table columns: `День` · `Наличные` · `QR` · `Перевод` · `Расхождение` · `Сессии` · `Игра, ч` · `Бар`.
- Summary strip, each value on its own: `Наличные за период`, `QR`, `Перевод`, `Расхождения`.
- Day sheet: `Наличные` (`На начало`, `Пришло за день`, `Должно было быть`, `Насчитали`, `Расхождение`), `Безнал · сверяется по банку`, `Зал` (`Сессий`, `Часы игры`, `Бесплатно` with the note `друзья, компенсации — отдельно от выручки`, `Бар`). The sheet uses the list item and loads nothing extra.

- [ ] **Step 1: Regenerate the types**

Run (repo root, leave running): `uv run uvicorn core.api.main:app --port 8000`
Run (in `web/`): `npm run generate:types`
Expected: `web/src/types/api.ts` gains `BusinessDayHistoryItem`, `FeedEventResponse`, `FeedKind`, `ProductResponse.category`, `HallConsoleResponse.free_since`, and `BusinessDaySummaryResponse.free_minutes_total`. Stop uvicorn.

In `web/src/lib/api.ts`, add the type exports:

```ts
export type BusinessDayHistoryItem = components["schemas"]["BusinessDayHistoryItem"];
export type FeedEventResponse = components["schemas"]["FeedEventResponse"];
export type FeedKind = components["schemas"]["FeedKind"];
```

and change / add the client methods:

```ts
  businessDayHistory: () => request<BusinessDayHistoryItem[]>("/api/business-days?limit=30"),
  businessDayFeed: (businessDayId: number) =>
    request<FeedEventResponse[]>(`/api/business-days/${businessDayId}/feed`),
```

- [ ] **Step 2: Update the tests (they now fail)**

In `web/tests/HistoryPage.test.tsx`, extend `DAY`:

```ts
const DAY = {
  id: 3,
  opened_at: "2026-09-24T04:00:00Z",
  closed_at: "2026-09-24T20:00:00Z",
  opening_cash: 5000,
  expected_cash: 5300,
  counted_cash: 5200,
  cash_total: 300,
  qr_total: 2900,
  transfer_total: 450,
  sessions_count: 27,
  minutes_total: 2290,
  free_minutes_total: 80,
  bar_sales_total: 860,
};
```

Remove the `/summary` branch from `renderPage`'s fetch mock. Replace the two row/sheet tests with:

```tsx
  it("lists a closed day with cash and non-cash apart", async () => {
    renderPage([DAY, { ...DAY, id: 4, closed_at: null }]);
    const row = await screen.findByRole("button", { name: /чт, 24\.09/ });
    expect(row).toHaveTextContent("10:00 → 02:00");
    expect(row).toHaveTextContent("2 900"); // QR
    expect(row).toHaveTextContent("450"); // transfer
    expect(row).toHaveTextContent("−100");
    expect(row).toHaveTextContent("38:10");
    expect(screen.getAllByRole("button", { name: /\d\d\.\d\d/ })).toHaveLength(1);
  });

  it("totals the period with each payment method on its own", async () => {
    renderPage([DAY, { ...DAY, id: 5, opened_at: "2026-09-23T04:00:00Z", closed_at: "2026-09-23T20:00:00Z", counted_cash: 5300 }]);
    const totals = await screen.findByRole("region", { name: "Итого за период" });
    expect(within(totals).getByText("5 800")).toBeInTheDocument(); // QR 2 900 × 2
    expect(within(totals).getByText("900")).toBeInTheDocument(); // transfer 450 × 2
  });

  it("opens the day's breakdown, free hours included", async () => {
    renderPage([DAY]);
    fireEvent.click(await screen.findByRole("button", { name: /чт, 24\.09/ }));
    const sheet = await screen.findByRole("dialog", { name: "чт, 24.09" });
    expect(within(sheet).getByText("QR").closest("div")).toHaveTextContent("2 900");
    expect(within(sheet).getByText("Бесплатно").closest("div")).toHaveTextContent("1 ч 20 мин");
  });
```

In `web/tests/HallPage.test.tsx`, add the seven total fields (all `0`) to the history test's day fixture.

Run: `npm test -- tests/HistoryPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Rewrite `HistoryPage.tsx`**

```tsx
// web/src/features/hall/HistoryPage.tsx
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StateChip } from "@/components/ui/state-chip";
import { api, type BusinessDayHistoryItem } from "@/lib/api";
import { formatClock, formatDayLabel } from "@/lib/bishkek";
import { formatAmount, formatHoursClock, formatHoursMinutes, formatSignedSom, pluralRu } from "@/lib/format";
import { cn } from "@/lib/utils";

const COLUMNS =
  "md:grid-cols-[minmax(140px,1.4fr)_repeat(3,minmax(64px,1fr))_minmax(96px,1fr)_repeat(3,minmax(56px,.8fr))]";

function discrepancyOf(day: BusinessDayHistoryItem): number {
  return (day.counted_cash ?? 0) - (day.expected_cash ?? 0);
}

const dayWord = (n: number) => pluralRu(n, ["день", "дня", "дней"]);

export function HistoryPage({ onBack }: { onBack: () => void }) {
  const historyQuery = useQuery({ queryKey: ["business-day-history"], queryFn: api.businessDayHistory });
  const [selected, setSelected] = useState<BusinessDayHistoryItem | null>(null);

  const days = (historyQuery.data ?? []).filter((day) => day.closed_at !== null);
  const sum = (pick: (day: BusinessDayHistoryItem) => number) => days.reduce((total, day) => total + pick(day), 0);
  const withDiff = days.filter((day) => discrepancyOf(day) !== 0);
  const diffTotal = sum(discrepancyOf);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={onBack} autoFocus>
          ← Зал
        </Button>
        <h1 className="font-display text-[26px] font-extrabold tracking-tight">История дней</h1>
        {days.length > 0 && (
          <span className="inline-flex h-[30px] items-center rounded-full border border-line bg-surface px-3 text-[13px] text-fg-muted">
            {days.length} {pluralRu(days.length, ["закрытый", "закрытых", "закрытых"])} {dayWord(days.length)}
          </span>
        )}
      </div>

      {historyQuery.isLoading ? (
        <div>Загрузка…</div>
      ) : days.length === 0 ? (
        <p className="text-sm text-fg-muted">Закрытых дней пока нет.</p>
      ) : (
        <>
          <section
            aria-label="Итого за период"
            className="mb-4 grid w-fit max-w-full grid-cols-2 rounded-xl border border-line bg-surface sm:flex"
          >
            <Total label="Наличные за период" value={formatAmount(sum((d) => d.cash_total))} big />
            <Total label="QR" value={formatAmount(sum((d) => d.qr_total))} />
            <Total label="Перевод" value={formatAmount(sum((d) => d.transfer_total))} />
            <Total
              label="Расхождения"
              value={withDiff.length === 0 ? "всё сошлось" : formatSignedSom(diffTotal).replace(" сом", "")}
              note={withDiff.length > 0 ? `${withDiff.length} ${dayWord(withDiff.length)}` : undefined}
              className={diffTotal < 0 ? "text-status-circle" : undefined}
            />
          </section>

          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div
              aria-hidden
              className={cn(
                "hidden gap-3 bg-bg px-[18px] py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted md:grid [&>span:not(:first-child)]:text-right",
                COLUMNS,
              )}
            >
              <span>День</span>
              <span>Наличные</span>
              <span>QR</span>
              <span>Перевод</span>
              <span>Расхождение</span>
              <span>Сессии</span>
              <span>Игра, ч</span>
              <span>Бар</span>
            </div>
            {days.map((day) => {
              const diff = discrepancyOf(day);
              return (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => setSelected(day)}
                  className={cn(
                    "grid w-full grid-cols-4 items-center gap-x-2 gap-y-2.5 border-t border-line px-[18px] py-3 text-left text-sm first-of-type:border-t-0 hover:bg-surface-2 md:gap-3 md:first-of-type:border-t",
                    COLUMNS,
                  )}
                >
                  <span className="col-span-4 md:col-span-1">
                    <b className="block font-semibold">{formatDayLabel(Date.parse(day.opened_at))}</b>
                    <span className="text-[13px] text-fg-muted">
                      {formatClock(Date.parse(day.opened_at))} → {formatClock(Date.parse(day.closed_at!))}
                    </span>
                  </span>
                  <Cell label="Наличные" value={formatAmount(day.cash_total)} />
                  <Cell label="QR" value={formatAmount(day.qr_total)} />
                  <Cell label="Перевод" value={formatAmount(day.transfer_total)} />
                  <Cell
                    label="Расхождение"
                    value={diff === 0 ? "сошлось" : formatSignedSom(diff).replace(" сом", "")}
                    className={diff < 0 ? "text-status-circle" : diff === 0 ? "font-sans font-normal text-fg-faint" : undefined}
                  />
                  <Cell label="Сессии" value={String(day.sessions_count)} dim />
                  <Cell label="Игра, ч" value={formatHoursClock(day.minutes_total)} dim />
                  <Cell label="Бар" value={formatAmount(day.bar_sales_total)} dim />
                </button>
              );
            })}
          </div>
        </>
      )}

      {selected && <DaySheet day={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

function Total({ label, value, note, big = false, className }: { label: string; value: string; note?: string; big?: boolean; className?: string }) {
  return (
    <div className="grid content-center border-l border-line px-4 py-2 first:border-l-0 max-sm:[&:nth-child(3)]:border-l-0 max-sm:[&:nth-child(n+3)]:border-t">
      <span className="text-[11px] text-fg-muted">{label}</span>
      <span className={cn("num font-bold", big ? "text-2xl" : "text-lg", className)}>
        {value}
        {note && <span className="ml-1 font-sans text-[11px] font-normal text-fg-muted">сом · {note}</span>}
      </span>
    </div>
  );
}

function Cell({ label, value, dim = false, className }: { label: string; value: string; dim?: boolean; className?: string }) {
  return (
    <span className={cn("num font-bold md:text-right", dim && "font-medium text-fg-muted", className)}>
      <span className="block font-sans text-[11px] font-medium text-fg-faint md:hidden">{label}</span>
      {value}
    </span>
  );
}

function DaySheet({ day, onClose }: { day: BusinessDayHistoryItem; onClose: () => void }) {
  const diff = discrepancyOf(day);
  const tone = diff < 0 ? "circle" : "triangle";

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent tone={tone}>
        <SheetHeader>
          <SheetTitle>{formatDayLabel(Date.parse(day.opened_at))}</SheetTitle>
          <StateChip tone={tone}>
            {formatClock(Date.parse(day.opened_at))} → {formatClock(Date.parse(day.closed_at!))}
          </StateChip>
        </SheetHeader>
        <SheetBody>
          <Section title="Наличные">
            <Row label="На начало" value={formatAmount(day.opening_cash)} />
            <Row label="Пришло за день" value={`+${formatAmount(day.cash_total)}`} />
            <Row label="Должно было быть" value={formatAmount(day.expected_cash ?? 0)} />
            <Row label="Насчитали" value={formatAmount(day.counted_cash ?? 0)} />
            <Row
              label="Расхождение"
              value={diff === 0 ? "сошлось" : formatSignedSom(diff)}
              className={diff < 0 ? "text-status-circle" : diff === 0 ? "text-status-triangle" : undefined}
            />
          </Section>
          <Section title="Безнал · сверяется по банку">
            <Row label="QR" note="MBank, O!Dengi" value={formatAmount(day.qr_total)} />
            <Row label="Перевод по номеру" value={formatAmount(day.transfer_total)} />
          </Section>
          <Section title="Зал">
            <Row label="Сессий" value={String(day.sessions_count)} />
            <Row label="Часы игры" value={formatHoursClock(day.minutes_total)} />
            <Row label="Бесплатно" note="друзья, компенсации — отдельно от выручки" value={formatHoursMinutes(day.free_minutes_total)} />
            <Row label="Бар" value={formatAmount(day.bar_sales_total)} />
          </Section>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="field-label">{title}</h3>
      <dl className="rounded-xl border border-line bg-bg px-3.5 py-1">{children}</dl>
    </section>
  );
}

function Row({ label, value, note, className }: { label: string; value: string; note?: string; className?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-line py-2.5 last:border-b-0">
      <dt className="text-[13.5px] text-fg-muted">
        <span>{label}</span>
        {note && <small className="block text-[11.5px] text-fg-faint">{note}</small>}
      </dt>
      <dd className={cn("num text-base font-bold", className)}>{value}</dd>
    </div>
  );
}
```

- [ ] **Step 4: Run everything**

Run (in `web/`): `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "Show every day's totals and free hours in the history"
```

---

### Task 18: Idle time on a free console

**Files:**
- Modify: `web/src/lib/format.ts`, `web/src/features/hall/ConsoleCard.tsx`
- Test: `web/tests/format.test.ts`, `web/tests/ConsoleCard.test.tsx`

**Interfaces:**
- Produces: `formatShortMinutes(totalMinutes: number): string` — `"43 мин"`, `"2 ч 10 мин"`, `"3 ч"`.
- Copy: the free card caption is `с {HH:MM} · простой {formatShortMinutes}`. When `free_since` is absent, there is no caption.

- [ ] **Step 1: Write the failing tests**

Append to `web/tests/format.test.ts` (and import `formatShortMinutes`):

```ts
describe("formatShortMinutes", () => {
  it("drops the zero part", () => {
    expect(formatShortMinutes(43)).toBe("43 мин");
    expect(formatShortMinutes(130)).toBe("2 ч 10 мин");
    expect(formatShortMinutes(180)).toBe("3 ч");
  });
});
```

Append to `web/tests/ConsoleCard.test.tsx`:

```tsx
  it("says how long a free console has been idle", () => {
    renderCard({ ...FREE, free_since: new Date(NOW - 43 * 60_000).toISOString() });
    expect(screen.getByText(/с 23:57 · простой 43 мин/)).toBeInTheDocument();
  });
```

Run: `npm test -- tests/format.test.ts tests/ConsoleCard.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement**

Append to `web/src/lib/format.ts`:

```ts
/** "43 мин", "2 ч 10 мин", "3 ч" — for idle time, where "0 ч" would be noise. */
export function formatShortMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} мин`;
  return minutes === 0 ? `${hours} ч` : `${hours} ч ${minutes} мин`;
}
```

In `web/src/features/hall/ConsoleCard.tsx`:
- Change the caption call to `caption(timing, consoleView, lastSegment, nowMs)` and the function signature to `caption(timing: CardTiming, consoleView: HallConsoleResponse, last: SegmentResponse | undefined, nowMs: number)`, with `const session = consoleView.session;` inside.
- Put this before the `if (!session) return null;` line:

```tsx
  if (timing.status === "free" && consoleView.free_since) {
    const freeSinceMs = Date.parse(consoleView.free_since);
    return (
      <>
        с {formatClock(freeSinceMs)} · простой <b>{formatShortMinutes(Math.max(0, Math.floor((nowMs - freeSinceMs) / 60_000)))}</b>
      </>
    );
  }
```

- Import `formatShortMinutes`.

- [ ] **Step 3: Run everything**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add web
git commit -m "Show how long a free console has been idle"
```

---

### Task 19: Bar categories

**Files:**
- Modify: `web/src/features/hall/barLines.ts`, `web/src/features/hall/BarDialog.tsx`
- Test: `web/tests/barLines.test.ts`, `web/tests/BarDialog.test.tsx`

**Interfaces:**
- Produces: `OTHER_CATEGORY = "Другое"`; `productCategories(products: ProductResponse[]): string[]` returns the categories in catalog order, plus «Другое» when some products have none, or `[]` when there are fewer than two groups (tabs would be pointless); `inCategory(product: ProductResponse, category: string): boolean`.
- Copy: tabs `Всё` + categories, as pill buttons with `aria-pressed`, in a group labelled `Категории`.

- [ ] **Step 1: Write the failing tests**

Append to `web/tests/barLines.test.ts` (import `productCategories`, `inCategory`, `OTHER_CATEGORY` and `ProductResponse`):

```ts
function product(id: number, category: string | null): ProductResponse {
  return { id, name: `Товар ${id}`, price: 10, is_active: true, category };
}

describe("productCategories", () => {
  it("lists categories in catalog order and gathers the rest under «Другое»", () => {
    const products = [product(1, "Напитки"), product(2, "Еда"), product(3, "Напитки"), product(4, null)];
    expect(productCategories(products)).toEqual(["Напитки", "Еда", OTHER_CATEGORY]);
    expect(inCategory(products[3], OTHER_CATEGORY)).toBe(true);
    expect(inCategory(products[0], "Еда")).toBe(false);
  });

  it("returns no tabs for a single group", () => {
    expect(productCategories([product(1, null), product(2, null)])).toEqual([]);
    expect(productCategories([product(1, "Напитки")])).toEqual([]);
  });
});
```

Append to `web/tests/BarDialog.test.tsx`:

```tsx
  it("filters the catalog by category", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/products") {
          return {
            ok: true,
            json: async () => [
              { id: 1, name: "Кола", price: 60, is_active: true, category: "Напитки" },
              { id: 2, name: "Сэндвич", price: 120, is_active: true, category: "Еда" },
            ],
          };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );
    renderDialog([]);

    fireEvent.click(await screen.findByRole("button", { name: "Еда" }));
    expect(screen.getByText("Сэндвич")).toBeInTheDocument();
    expect(screen.queryByText("Кола")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Всё" }));
    expect(screen.getByText("Кола")).toBeInTheDocument();
  });
```

Run: `npm test -- tests/barLines.test.ts tests/BarDialog.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement**

Append to `web/src/features/hall/barLines.ts` (add `ProductResponse` to the type import):

```ts
export const OTHER_CATEGORY = "Другое";

/** Tabs for the bar: categories in catalog order, "Другое" for the rest; none for one group. */
export function productCategories(products: ProductResponse[]): string[] {
  const named: string[] = [];
  let hasUncategorised = false;
  for (const product of products) {
    const category = product.category?.trim();
    if (!category) hasUncategorised = true;
    else if (!named.includes(category)) named.push(category);
  }
  const groups = hasUncategorised && named.length > 0 ? [...named, OTHER_CATEGORY] : named;
  return groups.length >= 2 ? groups : [];
}

export function inCategory(product: ProductResponse, category: string): boolean {
  const own = product.category?.trim();
  return category === OTHER_CATEGORY ? !own : own === category;
}
```

In `web/src/features/hall/BarDialog.tsx`:
- Import `useState`, `productCategories` and `inCategory`, and add `const [category, setCategory] = useState<string | null>(null);`.
- Compute `const products = productsQuery.data ?? []; const categories = productCategories(products); const shown = category === null ? products : products.filter((p) => inCategory(p, category));`.
- Above the product grid:

```tsx
          {categories.length > 0 && (
            <div role="group" aria-label="Категории" className="flex flex-wrap gap-2">
              {[null, ...categories].map((value) => (
                <button
                  key={value ?? "all"}
                  type="button"
                  aria-pressed={category === value}
                  onClick={() => setCategory(value)}
                  className="h-8 rounded-full border border-line px-3 text-[13px] text-fg-muted hover:text-fg aria-pressed:border-fg aria-pressed:bg-fg aria-pressed:font-semibold aria-pressed:text-ink"
                >
                  {value ?? "Всё"}
                </button>
              ))}
            </div>
          )}
```

- Map `shown` instead of `productsQuery.data ?? []` in the product grid.

- [ ] **Step 3: Run everything**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add web
git commit -m "Add category tabs to the bar"
```

---

### Task 20: The day feed — a sheet, and a column on wide screens

**Files:**
- Create: `web/src/features/hall/feedModel.ts`, `web/src/features/hall/DayFeed.tsx`, `web/src/lib/useMediaQuery.ts`
- Modify: `web/src/features/hall/HallPage.tsx`
- Test: `web/tests/feedModel.test.ts` (new), `web/tests/useMediaQuery.test.tsx` (new), `web/tests/HallPage.test.tsx`

**Interfaces:**
- Consumes: `api.businessDayFeed`, `FeedEventResponse` (Task 17); `formatClock`, `formatAmount`, `formatHoursMinutes`.
- Produces: `interface FeedLine { glyph: string; tone: Tone; who: string; what: string; amount: number | null; method: string | null }`; `describeFeedEvent(event: FeedEventResponse): FeedLine`.
- Produces: `DayFeed({ businessDayId, snapshotAt })` — a `ul` labelled `Лента дня`; empty state `Пока ничего не произошло.`
- Produces: `useMediaQuery(query: string): boolean`, which is `false` where `matchMedia` is unavailable (jsdom).
- Placement: the `Лента дня` button in the hall head opens a sheet (`DialogState` `{ kind: "feed" }`). At ≥ 1680px the button is hidden and the feed is a permanent right column (`bg-rail`, 340px). The column only mounts when `useMediaQuery("(min-width: 1680px)")` is true, so a narrow screen never fetches the feed twice.

**Wording (`describeFeedEvent`):**

| kind | condition | glyph · tone | what |
|---|---|---|---|
| session_started | session_kind `free` | □ · square | `бесплатно: «{reason}»` (or `бесплатно`) |
| session_started | `service` | — · muted | `служебная` |
| session_started | segment_kind `open` | △ · triangle | `открытое время` |
| session_started | package | ✕ · cross | `пакет {tariff_name}` (or `пакет`) |
| session_extended | segment_kind `open` | △ · triangle | `переход на открытое время` |
| session_extended | package | ✕ · cross | `продление: {tariff_name}` (or `продление`) |
| session_finished | console | ■ · muted | `завершена, {formatHoursMinutes(minutes)}` |
| session_finished | ticket | ■ · muted | `чек закрыт` |
| session_cancelled | — | — · muted | `отменена без оплаты` |
| payment | — | — · idle | `оплата`; method `нал` / `QR` / `перевод` |
| order | — | · · muted | `{product_name lower-cased}` + ` × {qty}` when qty > 1 |

`who` is `console_name` or `Чек №{session_id}`. `amount` is set for `payment` and `order`, otherwise `null`.

- [ ] **Step 1: Write the failing tests**

```ts
// web/tests/feedModel.test.ts
import { describe, expect, it } from "vitest";
import { describeFeedEvent } from "@/features/hall/feedModel";
import type { FeedEventResponse } from "@/lib/api";

function event(overrides: Partial<FeedEventResponse>): FeedEventResponse {
  return {
    at: "2026-09-29T18:38:00Z",
    kind: "session_started",
    session_id: 7,
    console_name: "PS 1",
    session_kind: "paid",
    segment_kind: "package",
    tariff_name: "3 часа",
    reason: null,
    product_name: null,
    qty: null,
    amount: null,
    method: null,
    minutes: null,
    ...overrides,
  };
}

describe("describeFeedEvent", () => {
  it("names a package start by its tariff", () => {
    expect(describeFeedEvent(event({}))).toMatchObject({ glyph: "✕", tone: "cross", who: "PS 1", what: "пакет 3 часа", amount: null });
  });

  it("shows why a session is free", () => {
    expect(describeFeedEvent(event({ session_kind: "free", reason: "друзья владельца" }))).toMatchObject({
      glyph: "□",
      what: "бесплатно: «друзья владельца»",
    });
  });

  it("describes a payment by method, and a ticket by its number", () => {
    const line = describeFeedEvent(event({ kind: "payment", console_name: null, session_id: 214, amount: 150, method: "qr" }));
    expect(line).toMatchObject({ who: "Чек №214", what: "оплата", amount: 150, method: "QR" });
  });

  it("describes bar orders and finished sessions", () => {
    expect(describeFeedEvent(event({ kind: "order", product_name: "Кола", qty: 2, amount: 120 })).what).toBe("кола × 2");
    expect(describeFeedEvent(event({ kind: "session_finished", minutes: 130 })).what).toBe("завершена, 2 ч 10 мин");
    expect(describeFeedEvent(event({ kind: "session_extended", segment_kind: "open" })).what).toBe("переход на открытое время");
  });
});
```

```tsx
// web/tests/useMediaQuery.test.tsx
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
```

`web/tests/HallPage.test.tsx`: in `stubApi`, before the final fallback, add

```ts
    if (url.endsWith("/feed")) {
      return {
        ok: true,
        json: async () => [
          {
            at: new Date().toISOString(), kind: "payment", session_id: 7, console_name: "PS5-1", session_kind: "paid",
            segment_kind: null, tariff_name: null, reason: null, product_name: null, qty: null, amount: 300, method: "cash", minutes: null,
          },
        ],
      };
    }
```

and a test:

```tsx
  it("opens the day feed from the hall", async () => {
    stubApi(snapshot([freeConsole(1)]));
    renderHall();

    fireEvent.click(await screen.findByRole("button", { name: "Лента дня" }));
    const feed = await screen.findByRole("list", { name: "Лента дня" });
    expect(await within(feed).findByText("PS5-1")).toBeInTheDocument();
    expect(within(feed).getByText("нал")).toBeInTheDocument();
  });
```

Run: `npm test -- tests/feedModel.test.ts tests/useMediaQuery.test.tsx tests/HallPage.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Implement**

```ts
// web/src/lib/useMediaQuery.ts
import { useSyncExternalStore } from "react";

/** A CSS media query as React state; false where matchMedia is missing (tests, old browsers). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}
```

```ts
// web/src/features/hall/feedModel.ts
import type { Tone } from "@/components/ui/tone";
import type { FeedEventResponse } from "@/lib/api";
import { formatHoursMinutes } from "@/lib/format";

export interface FeedLine {
  glyph: string;
  tone: Tone;
  who: string;
  what: string;
  amount: number | null;
  method: string | null;
}

const METHOD_LABELS: Record<string, string> = { cash: "нал", qr: "QR", transfer: "перевод" };

export function describeFeedEvent(event: FeedEventResponse): FeedLine {
  const who = event.console_name ?? `Чек №${event.session_id}`;
  const line = (glyph: string, tone: Tone, what: string): FeedLine => ({
    glyph,
    tone,
    who,
    what,
    amount: event.kind === "payment" || event.kind === "order" ? event.amount : null,
    method: event.method ? METHOD_LABELS[event.method] : null,
  });

  switch (event.kind) {
    case "session_started":
      if (event.session_kind === "free") return line("□", "square", event.reason ? `бесплатно: «${event.reason}»` : "бесплатно");
      if (event.session_kind === "service") return line("", "muted", "служебная");
      if (event.segment_kind === "open") return line("△", "triangle", "открытое время");
      return line("✕", "cross", event.tariff_name ? `пакет ${event.tariff_name}` : "пакет");
    case "session_extended":
      if (event.segment_kind === "open") return line("△", "triangle", "переход на открытое время");
      return line("✕", "cross", event.tariff_name ? `продление: ${event.tariff_name}` : "продление");
    case "session_finished":
      return line("■", "muted", event.console_name ? `завершена, ${formatHoursMinutes(event.minutes ?? 0)}` : "чек закрыт");
    case "session_cancelled":
      return line("", "muted", "отменена без оплаты");
    case "payment":
      return line("", "idle", "оплата");
    case "order": {
      const name = (event.product_name ?? "товар").toLowerCase();
      return line("·", "muted", event.qty && event.qty > 1 ? `${name} × ${event.qty}` : name);
    }
  }
}
```

```tsx
// web/src/features/hall/DayFeed.tsx
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatClock } from "@/lib/bishkek";
import { formatAmount } from "@/lib/format";
import { describeFeedEvent } from "./feedModel";

interface DayFeedProps {
  businessDayId: number;
  /** The hall snapshot's generated_at: every hall change refreshes the feed. */
  snapshotAt: string | undefined;
}

export function DayFeed({ businessDayId, snapshotAt }: DayFeedProps) {
  const { data } = useQuery({
    queryKey: ["business-day-feed", businessDayId, snapshotAt],
    queryFn: () => api.businessDayFeed(businessDayId),
    placeholderData: keepPreviousData,
  });

  if (data === undefined) return <div className="text-sm text-fg-muted">Загрузка…</div>;
  if (data.length === 0) return <p className="text-sm text-fg-faint">Пока ничего не произошло.</p>;

  return (
    <ul aria-label="Лента дня" className="grid">
      {data.map((event, index) => {
        const line = describeFeedEvent(event);
        return (
          <li
            key={`${event.kind}-${event.session_id}-${event.at}-${index}`}
            data-tone={line.tone}
            className="grid grid-cols-[44px_16px_minmax(0,1fr)_auto] items-baseline gap-2 border-b border-dashed border-line py-2 text-[13.5px]"
          >
            <time className="num text-[12.5px] text-fg-faint">{formatClock(Date.parse(event.at))}</time>
            <span aria-hidden className="text-center text-xs font-bold text-tone">
              {line.glyph}
            </span>
            <span className="text-fg-muted">
              <b className="font-medium text-fg">{line.who}</b> · {line.what}
            </span>
            <span className="num whitespace-nowrap">
              {line.amount === null ? "" : formatAmount(line.amount)}
              {line.method && <span className="ml-1 font-sans text-[11px] text-fg-faint">{line.method}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
```

In `HallPage.tsx`:
1. Imports: `DayFeed`, `useMediaQuery`, plus `Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle` from `@/components/ui/sheet`.
2. `DialogState`: add `| { kind: "feed" }`.
3. `const wide = useMediaQuery("(min-width: 1680px)");` and `const dayId = hall?.business_day_open ? hall.business_day_id : null;`.
4. In the hall-head actions, after `+ Продажа без игры`: `{!wide && <Button variant="outline" onClick={() => setDialog({ kind: "feed" })}>Лента дня</Button>}`.
5. Wrap `<main>` and a new rail in a grid container:

```tsx
      <div className={wide && view === "hall" && dayId !== null ? "grid grid-cols-[minmax(0,1fr)_340px]" : undefined}>
        <main className="px-4 pb-10 pt-[18px] short:pt-2.5 sm:px-6">{/* …unchanged… */}</main>
        {wide && view === "hall" && dayId !== null && (
          <aside aria-label="Лента дня" className="border-l border-line bg-rail px-5 pb-10 pt-5">
            <h2 className="field-label">Лента дня</h2>
            <DayFeed businessDayId={dayId} snapshotAt={hall?.generated_at} />
          </aside>
        )}
      </div>
```

6. With the other dialog renders:

```tsx
      {dialog.kind === "feed" && dayId !== null && (
        <Sheet open onOpenChange={(open) => !open && closeDialog()}>
          <SheetContent tone="triangle">
            <SheetHeader>
              <SheetTitle>Лента дня</SheetTitle>
            </SheetHeader>
            <SheetBody>
              <DayFeed businessDayId={dayId} snapshotAt={hall?.generated_at} />
            </SheetBody>
          </SheetContent>
        </Sheet>
      )}
```

- [ ] **Step 3: Run everything**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add web
git commit -m "Add the day feed as a sheet and a wide-screen column"
```

---

### Task 21: Visual verification and wrap-up

**Files:**
- Modify: none expected. Fix anything found here in the file where it lives, with its own commit.

- [ ] **Step 1: Full check**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS, no lint warnings.

- [ ] **Step 2: Run the app against the real API**

Run `uv run alembic upgrade head`, then start the stack the usual way (see `README.md`; this machine may need `docker-compose.override.yml` for the port 5432 conflict). In SQLAdmin, give the bar products categories (Напитки, Еда, Снеки). Sign in, open a day, and create the concept's situation: one console per status (package with grace, last minutes, overtime, open time, free session, free), plus a walk-in ticket with two items, one extension and one split payment.

- [ ] **Step 3: Compare against the concept**

Compare with `docs/design/concept-hall-v2.html` at these sizes, in both themes (switch with the top-bar theme button):
- 1366×768: both rows of consoles visible without scrolling.
- 1440×900 and 1920×1080: 3×2 grid, no holes.
- 375 wide: no horizontal scroll; the till is three columns plus the «За день» row; sheets open from the bottom.

Check, in order:
1. Warn and overtime cards flood with colour; the others stay calm.
2. The warn button has dark text on amber in both themes.
3. The overtime `Продлить` button is neutral (white in dark, black in light).
4. A debt strip is neutral, not amber.
5. Keys 1–9 open consoles; `Esc` closes a sheet; digits typed into the payment amount do not open a console.
6. Stopping a session with a bar debt from the details sheet lands on the payment sheet (settle flow); closing the day from the top bar still returns to the close-day dialog after settling.
7. The theme follows the club clock in `По времени суток` mode, and a reload does not flash the other theme.
8. A free console shows `с HH:MM · простой N мин`, counted from the last session or from the day's opening, whichever is later.
9. The day feed lists the start, the bar order, the extension (at the time it was sold) and both payments, newest first. It is a sheet below 1680px and a column at 1920px.
10. The bar shows category tabs; history rows show QR and transfer, and the day sheet shows «Бесплатно».

- [ ] **Step 4: Report**

Report to the owner. `CLAUDE.md` asks for behaviour changes that `docs/SPEC.md` does not describe to be pointed out:
- New hall behaviour not in SPEC: hotkeys 1–9, the theme switch with the «По времени суток» mode, the session details sheet, and the till in the top bar.
- New in the data model: `session_segments.created_at` (NULL for rows before the migration, so older extensions do not appear in feeds of past days) and `products.category` (free text, set in SQLAdmin). This reverses the Stage 4 plan's "no product categories", at the owner's request.
- New API: `GET /api/business-days/{id}/feed`, totals on `GET /api/business-days`, `free_since` on hall consoles, `free_minutes_total` on the day summary.
