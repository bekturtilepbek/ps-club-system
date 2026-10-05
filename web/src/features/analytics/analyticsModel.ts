import type { Group } from "./periods";

/** Mon-first short weekday names. */
export const WEEKDAYS_FULL = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

const MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

export function slotLabel(weekday: number, hour: number): string {
  return `${WEEKDAYS_FULL[weekday]}, ${pad2(hour)}:00–${pad2((hour + 1) % 24)}:00`;
}

/** An empty cell stays faintly visible so the grid reads as a grid; load above 100 is clamped. */
export function heatOpacity(loadPercent: number): number {
  const clamped = Math.min(100, Math.max(0, loadPercent));
  return 0.06 + (clamped / 100) * 0.94;
}

export function formatChange(percent: number | null): string {
  if (percent === null) return "—";
  const rounded = Math.round(percent);
  if (rounded === 0) return "0%";
  return rounded > 0 ? `+${rounded}%` : `−${Math.abs(rounded)}%`;
}

export function changeTone(percent: number | null): "up" | "down" | "flat" {
  if (percent === null || Math.round(percent) === 0) return "flat";
  return percent > 0 ? "up" : "down";
}

/** `point` is the bucket's first date, "2026-09-14". */
export function formatPeriodLabel(point: string, group: Group): string {
  const [year, month, day] = point.split("-").map(Number);
  if (group === "month") return `${MONTHS[month - 1]} ${year}`;
  const dayMonth = `${pad2(day)}.${pad2(month)}`;
  return group === "week" ? `нед. ${dayMonth}` : dayMonth;
}
