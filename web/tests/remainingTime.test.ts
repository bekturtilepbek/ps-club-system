import { describe, expect, it } from "vitest";
import { computeCardTiming } from "@/features/hall/remainingTime";
import type { HallConsoleResponse } from "@/lib/api";

const WARN_MINUTES = 5;

function consoleWithSession(overrides: Partial<HallConsoleResponse["session"]> = {}): HallConsoleResponse {
  return {
    id: 1,
    zone_id: 1,
    name: "PS5-1",
    is_active: true,
    charge_total: 150,
    paid_total: 0,
    balance: 150,
    session: {
      id: 1,
      kind: "paid",
      reason: null,
      status: "active",
      started_at: "2026-01-01T10:00:00+06:00",
      grace_until: "2026-01-01T10:03:00+06:00",
      segments: [
        {
          id: 1,
          tariff_id: 1,
          kind: "package",
          starts_at: "2026-01-01T10:03:00+06:00",
          ends_at: "2026-01-01T11:03:00+06:00",
          price_snapshot: 150,
          amount: 150,
          ...overrides,
        },
      ],
      ...overrides,
    },
  } as HallConsoleResponse;
}

describe("computeCardTiming", () => {
  it("is free when there is no session", () => {
    const console = consoleWithSession();
    console.session = null;
    expect(computeCardTiming(console, Date.now(), WARN_MINUTES).status).toBe("free");
  });

  it("is maintenance when the console is inactive", () => {
    const console = consoleWithSession();
    console.is_active = false;
    expect(computeCardTiming(console, Date.now(), WARN_MINUTES).status).toBe("maintenance");
  });

  it("is package_running well before the end", () => {
    const console = consoleWithSession();
    const now = new Date("2026-01-01T10:30:00+06:00").getTime();
    const timing = computeCardTiming(console, now, WARN_MINUTES);
    expect(timing.status).toBe("package_running");
    expect(timing.remainingMs).toBeGreaterThan(0);
  });

  it("is package_warn inside the warn window", () => {
    const console = consoleWithSession();
    const now = new Date("2026-01-01T10:59:00+06:00").getTime(); // 4 min left
    expect(computeCardTiming(console, now, WARN_MINUTES).status).toBe("package_warn");
  });

  it("is package_overtime with a live counter after the end", () => {
    const console = consoleWithSession();
    const now = new Date("2026-01-01T11:05:00+06:00").getTime(); // 2 min over
    const timing = computeCardTiming(console, now, WARN_MINUTES);
    expect(timing.status).toBe("package_overtime");
    expect(timing.overtimeMs).toBeGreaterThanOrEqual(2 * 60_000 - 1000);
  });

  it("is open_running for an open-time segment with no end", () => {
    const console = consoleWithSession({ kind: "open", ends_at: null, amount: null } as never);
    const now = new Date("2026-01-01T10:30:00+06:00").getTime();
    expect(computeCardTiming(console, now, WARN_MINUTES).status).toBe("open_running");
  });

  it("shows elapsed open time that grows with the clock", () => {
    // Open segment starts accruing at 10:03 (after grace).
    const console = consoleWithSession({ kind: "open", ends_at: null, amount: null } as never);
    const startMs = new Date("2026-01-01T10:03:00+06:00").getTime();

    const early = computeCardTiming(console, startMs + 60_000, WARN_MINUTES);
    const later = computeCardTiming(console, startMs + 12 * 60_000 + 34_000, WARN_MINUTES);
    expect(early.elapsedMs).toBe(60_000);
    expect(later.elapsedMs).toBe(12 * 60_000 + 34_000);
    expect(early.remainingMs).toBeNull();
    expect(early.overtimeMs).toBeNull();

    // Before the open segment starts accruing (grace / queued behind a package): zero, not negative.
    expect(computeCardTiming(console, startMs - 30_000, WARN_MINUTES).elapsedMs).toBe(0);
  });

  it("interpolates the open-time charge between snapshots", () => {
    // 120 som/h, last snapshot said 0 charged, 30 som paid up front.
    const console = consoleWithSession({ kind: "open", ends_at: null, amount: null, price_snapshot: 120 } as never);
    console.charge_total = 0;
    console.paid_total = 30;
    console.balance = -30;
    const startMs = new Date("2026-01-01T10:03:00+06:00").getTime();

    const timing = computeCardTiming(console, startMs + 45 * 60_000, WARN_MINUTES);
    expect(timing.chargeTotal).toBe(90); // 45 min at 2 som/min
    expect(timing.balance).toBe(60);
  });

  it("adds a running open segment on top of an already-priced package", () => {
    const console = consoleWithSession();
    console.session!.segments.push({
      id: 2,
      tariff_id: 2,
      kind: "open",
      starts_at: "2026-01-01T11:03:00+06:00",
      ends_at: null,
      price_snapshot: 60,
      amount: null,
    } as never);
    const now = new Date("2026-01-01T11:33:00+06:00").getTime(); // 30 min of open time

    const timing = computeCardTiming(console, now, WARN_MINUTES);
    expect(timing.status).toBe("open_running");
    expect(timing.chargeTotal).toBe(150 + 30);
    expect(timing.balance).toBe(180);
  });

  it("never shows the charge lower than the server's latest figure", () => {
    const console = consoleWithSession({ kind: "open", ends_at: null, amount: null, price_snapshot: 120 } as never);
    console.charge_total = 500;
    console.paid_total = 0;
    const startMs = new Date("2026-01-01T10:03:00+06:00").getTime();

    const timing = computeCardTiming(console, startMs + 60_000, WARN_MINUTES);
    expect(timing.chargeTotal).toBe(500);
    expect(timing.balance).toBe(500);
  });

  it("is free_session for a free-of-charge session", () => {
    const console = consoleWithSession({ kind: "free" } as never);
    const now = new Date("2026-01-01T10:30:00+06:00").getTime();
    const timing = computeCardTiming(console, now, WARN_MINUTES);
    expect(timing.status).toBe("free_session");
    expect(timing.remainingMs).toBeNull();
    expect(timing.overtimeMs).toBeNull();
  });

  it("is service_session for a service session", () => {
    const console = consoleWithSession({ kind: "service" } as never);
    const now = new Date("2026-01-01T10:30:00+06:00").getTime();
    const timing = computeCardTiming(console, now, WARN_MINUTES);
    expect(timing.status).toBe("service_session");
    expect(timing.remainingMs).toBeNull();
    expect(timing.overtimeMs).toBeNull();
  });

  it("counts overtime up continuously rather than snapping to a fixed step", () => {
    // Domain rule: the overtime display is a live counter, not a quantized
    // "+7 min" jump. overtimeMs must track exactly how far past `ends_at` we are.
    const console = consoleWithSession();
    const endsAtMs = new Date("2026-01-01T11:03:00+06:00").getTime();

    const oneSecondOver = computeCardTiming(console, endsAtMs + 1_000, WARN_MINUTES);
    expect(oneSecondOver.status).toBe("package_overtime");
    expect(oneSecondOver.overtimeMs).toBe(1_000);

    const ninetySecondsOver = computeCardTiming(console, endsAtMs + 90_000, WARN_MINUTES);
    expect(ninetySecondsOver.status).toBe("package_overtime");
    expect(ninetySecondsOver.overtimeMs).toBe(90_000);

    const tenMinutesOver = computeCardTiming(console, endsAtMs + 10 * 60_000, WARN_MINUTES);
    expect(tenMinutesOver.overtimeMs).toBe(10 * 60_000);

    // Strictly increasing as time passes — never stuck at a fixed value.
    expect(ninetySecondsOver.overtimeMs!).toBeGreaterThan(oneSecondOver.overtimeMs!);
    expect(tenMinutesOver.overtimeMs!).toBeGreaterThan(ninetySecondsOver.overtimeMs!);
  });
});
