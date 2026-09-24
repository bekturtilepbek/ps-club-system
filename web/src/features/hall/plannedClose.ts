// Asia/Bishkek has had no DST since 2005 — a fixed UTC+6 offset, hardcoded here rather
// than pulled in via a timezone library the frontend doesn't otherwise depend on.
const BISHKEK_UTC_OFFSET_MS = 6 * 60 * 60_000;

/** The next wall-clock occurrence of `plannedClose` ("HH:MM", Asia/Bishkek) at or after `nowMs`. */
export function nextPlannedCloseMs(nowMs: number, plannedClose: string): number {
  const [hours, minutes] = plannedClose.split(":").map(Number);
  const localNowMs = nowMs + BISHKEK_UTC_OFFSET_MS;
  const localDate = new Date(localNowMs);
  const localMidnightMs = Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate(),
  );
  let candidateLocalMs = localMidnightMs + (hours * 60 + minutes) * 60_000;
  if (candidateLocalMs <= localNowMs) candidateLocalMs += 24 * 60 * 60_000;
  return candidateLocalMs - BISHKEK_UTC_OFFSET_MS;
}

/**
 * Advisory only (CLAUDE.md: "продавать или нет — решает человек") — a heads-up that a
 * package would run past the planned close, not the precise segment-start math
 * `core/domain/segments.py` uses for real billing.
 */
export function packageEndsAfterPlannedClose(
  packageStartMs: number,
  durationMin: number,
  plannedClose: string,
): boolean {
  const packageEndMs = packageStartMs + durationMin * 60_000;
  return packageEndMs > nextPlannedCloseMs(packageStartMs, plannedClose);
}
