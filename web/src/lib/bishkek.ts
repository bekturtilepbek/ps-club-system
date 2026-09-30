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
