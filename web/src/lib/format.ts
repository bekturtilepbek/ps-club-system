const NBSP = "\u00a0";
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

/** "43 мин", "2 ч 10 мин", "3 ч" — for idle time, where "0 ч" would be noise. */
export function formatShortMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} мин`;
  return minutes === 0 ? `${hours} ч` : `${hours} ч ${minutes} мин`;
}
