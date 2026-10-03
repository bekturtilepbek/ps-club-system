import type { HallConsoleResponse, SegmentResponse } from "@/lib/api";
import { estimateOpenTimeAmount } from "@/lib/money";

export type CardStatus =
  | "free"
  | "maintenance"
  | "package_running"
  | "package_warn"
  | "package_overtime"
  | "open_running"
  | "free_session"
  | "service_session";

export interface CardTiming {
  status: CardStatus;
  remainingMs: number | null;
  overtimeMs: number | null;
  elapsedMs: number | null;
  chargeTotal: number;
  balance: number;
  /** The segment the timer is about (for a package that is followed by queued open time: the package). */
  segment: SegmentResponse | null;
  /** Set while open time bought during a package waits for the package to end: its hourly rate. */
  queuedOpenRate: number | null;
}

export function computeCardTiming(
  consoleView: HallConsoleResponse,
  nowMs: number,
  warnMinutes: number,
): CardTiming {
  if (!consoleView.is_active) {
    return { status: "maintenance", remainingMs: null, overtimeMs: null, elapsedMs: null, chargeTotal: 0, balance: 0, segment: null, queuedOpenRate: null };
  }

  const session = consoleView.session;
  if (!session) {
    return { status: "free", remainingMs: null, overtimeMs: null, elapsedMs: null, chargeTotal: 0, balance: 0, segment: null, queuedOpenRate: null };
  }

  const base = { chargeTotal: consoleView.charge_total, balance: consoleView.balance, segment: null, queuedOpenRate: null };

  if (session.kind === "free") {
    return { status: "free_session", remainingMs: null, overtimeMs: null, elapsedMs: null, ...base };
  }
  if (session.kind === "service") {
    return { status: "service_session", remainingMs: null, overtimeMs: null, elapsedMs: null, ...base };
  }

  const last = session.segments[session.segments.length - 1];
  // Open time bought while a package is still running starts at the package's end (CLAUDE.md rule 3).
  // Until then the guests are still on the paid package: keep counting that down instead of showing
  // "open time, 00:00", which would hide how long the paid time lasts.
  const before = session.segments[session.segments.length - 2];
  const queuedOpen =
    last?.kind === "open" && last.ends_at == null && new Date(last.starts_at).getTime() > nowMs && before?.kind === "package";
  const driving = queuedOpen ? before : last;
  if (driving?.kind === "package" && driving.ends_at) {
    const endsAtMs = new Date(driving.ends_at).getTime();
    const remainingMs = endsAtMs - nowMs;
    const queued = { segment: driving, queuedOpenRate: queuedOpen ? last.price_snapshot : null };
    if (remainingMs <= 0) {
      return { status: "package_overtime", remainingMs: null, overtimeMs: -remainingMs, elapsedMs: null, ...base, ...queued };
    }
    const status: CardStatus = remainingMs <= warnMinutes * 60_000 ? "package_warn" : "package_running";
    return { status, remainingMs, overtimeMs: null, elapsedMs: null, ...base, ...queued };
  }

  // Open time accrues per minute, but a snapshot is only pushed on a change, so the
  // server's charge_total can be hours old. Recompute it the way the backend does
  // (session_charge_total: fixed segment amounts + running open segments priced up to
  // now) so the sum stays live. max() keeps a fresher server figure from ever being
  // shown as going down. Display only — payments always use the server's numbers.
  const ordersTotal = session.orders.reduce((total, order) => total + order.qty * order.unit_price, 0);
  const liveCharge = ordersTotal + session.segments.reduce((total, segment) => {
    if (segment.amount != null) return total + segment.amount;
    if (segment.ends_at == null) {
      const elapsed = nowMs - new Date(segment.starts_at).getTime();
      return total + estimateOpenTimeAmount(elapsed, segment.price_snapshot);
    }
    return total;
  }, 0);
  const chargeTotal = Math.max(consoleView.charge_total, liveCharge);
  const balance = chargeTotal - consoleView.paid_total;
  // An open segment queued behind a still-running package starts at the package's
  // end (CLAUDE.md rule 3), so elapsed stays at zero until then.
  const elapsedMs = last ? Math.max(0, nowMs - new Date(last.starts_at).getTime()) : 0;

  return { status: "open_running", remainingMs: null, overtimeMs: null, elapsedMs, chargeTotal, balance, segment: last ?? null, queuedOpenRate: null };
}
