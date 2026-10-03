// Server time as "what the server last said, plus how long ago we heard it", counted on the
// monotonic performance clock. Counting on Date.now() instead would break whenever the PC's own
// clock is stepped while the till is open (Windows time sync, NTP, a hand-set clock): every timer
// would jump by the size of the step until the next server message arrived.
let anchorServerMs: number | null = null;
let anchorPerfMs = 0;

export function updateClockOffset(serverIso: string): void {
  anchorServerMs = new Date(serverIso).getTime();
  anchorPerfMs = performance.now();
}

export function serverNow(): number {
  // Before the first server message there is nothing better than the PC's clock.
  if (anchorServerMs === null) return Date.now();
  return anchorServerMs + (performance.now() - anchorPerfMs);
}
