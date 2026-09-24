/**
 * Display-only estimate of an open-time charge, mirroring
 * `core/domain/money.py::open_time_amount`: billed per minute at hourly rate / 60,
 * only the final total is rounded to a whole som.
 *
 * Never use this to decide a real payment amount — the backend is the source of
 * truth. It only keeps the hall card's running sum live between snapshots.
 */
export function estimateOpenTimeAmount(elapsedMs: number, hourlyRate: number): number {
  if (elapsedMs <= 0) return 0;
  return Math.round((elapsedMs * hourlyRate) / 3_600_000);
}
