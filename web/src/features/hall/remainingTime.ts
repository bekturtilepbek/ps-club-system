import type { HallConsoleResponse } from "@/lib/api";

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
  chargeTotal: number;
  balance: number;
}

export function computeCardTiming(
  consoleView: HallConsoleResponse,
  nowMs: number,
  warnMinutes: number,
): CardTiming {
  if (!consoleView.is_active) {
    return { status: "maintenance", remainingMs: null, overtimeMs: null, chargeTotal: 0, balance: 0 };
  }

  const session = consoleView.session;
  if (!session) {
    return { status: "free", remainingMs: null, overtimeMs: null, chargeTotal: 0, balance: 0 };
  }

  const base = { chargeTotal: consoleView.charge_total, balance: consoleView.balance };

  if (session.kind === "free") {
    return { status: "free_session", remainingMs: null, overtimeMs: null, ...base };
  }
  if (session.kind === "service") {
    return { status: "service_session", remainingMs: null, overtimeMs: null, ...base };
  }

  const last = session.segments[session.segments.length - 1];
  if (last?.kind === "package" && last.ends_at) {
    const endsAtMs = new Date(last.ends_at).getTime();
    const remainingMs = endsAtMs - nowMs;
    if (remainingMs <= 0) {
      return { status: "package_overtime", remainingMs: null, overtimeMs: -remainingMs, ...base };
    }
    const status: CardStatus = remainingMs <= warnMinutes * 60_000 ? "package_warn" : "package_running";
    return { status, remainingMs, overtimeMs: null, ...base };
  }

  return { status: "open_running", remainingMs: null, overtimeMs: null, ...base };
}
