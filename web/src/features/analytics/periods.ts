import { BISHKEK_UTC_OFFSET_MS } from "@/lib/bishkek";

export type PeriodPreset = "last7" | "last30" | "thisMonth" | "prevMonth" | "all" | "custom";
export type Group = "day" | "week" | "month";
export type DateRange = { from: string; to: string };

/** Before the club existed; the server clamps a range to [first business day, today]. */
export const ALL_TIME_FROM = "2000-01-01";

const DAY_MS = 24 * 60 * 60_000;

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function isoOf(wall: Date): string {
  return `${wall.getUTCFullYear()}-${pad2(wall.getUTCMonth() + 1)}-${pad2(wall.getUTCDate())}`;
}

/** A date on the club's wall clock ("2026-10-01"), whatever the machine's own timezone is. */
export function toIsoDate(ms: number): string {
  return isoOf(new Date(ms + BISHKEK_UTC_OFFSET_MS));
}

export function rangeForPreset(preset: Exclude<PeriodPreset, "custom">, nowMs: number): DateRange {
  const today = toIsoDate(nowMs);
  const wall = new Date(nowMs + BISHKEK_UTC_OFFSET_MS);
  switch (preset) {
    case "last7":
      return { from: toIsoDate(nowMs - 6 * DAY_MS), to: today };
    case "last30":
      return { from: toIsoDate(nowMs - 29 * DAY_MS), to: today };
    case "thisMonth":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "prevMonth": {
      const firstOfThis = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), 1);
      const lastOfPrev = new Date(firstOfThis - DAY_MS);
      return {
        from: `${lastOfPrev.getUTCFullYear()}-${pad2(lastOfPrev.getUTCMonth() + 1)}-01`,
        to: isoOf(lastOfPrev),
      };
    }
    case "all":
      return { from: ALL_TIME_FROM, to: today };
  }
}
