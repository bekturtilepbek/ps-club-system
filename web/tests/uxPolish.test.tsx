import { describe, expect, it } from "vitest";
import { sessionTimeline } from "@/features/hall/sessionTimeline";
import type { SessionResponse } from "@/lib/api";

function session(overrides: Partial<SessionResponse>): SessionResponse {
  return {
    id: 7, console_id: 3, business_day_id: 1, kind: "paid", reason: null, status: "active",
    started_at: "2026-09-29T14:31:00Z", grace_until: null, ended_at: null, comment: null,
    segments: [], orders: [], charge_total: 0, paid_total: 0, balance: 0,
    ...overrides,
  };
}

describe("sessionTimeline running open segment", () => {
  const open = (amount: number | null, endsAt: string | null) =>
    session({
      segments: [{ id: 1, tariff_id: 2, kind: "open", starts_at: "2026-09-29T14:34:00Z", ends_at: endsAt, price_snapshot: 120, amount }],
    });
  const amountAt = (iso: string, s: SessionResponse) =>
    sessionTimeline(s, () => "Открытое время", Date.parse(iso)).find((r) => r.key === "segment-1")!.amount;

  it("shows the accrued per-minute amount and grows with time", () => {
    expect(amountAt("2026-09-29T15:34:00Z", open(null, null))).toBe(120);
    expect(amountAt("2026-09-29T15:49:00Z", open(null, null))).toBe(150);
    expect(amountAt("2026-09-29T14:35:00Z", open(null, null))).toBe(2);
  });

  it("keeps the backend amount for a closed segment and null for a queued one", () => {
    expect(amountAt("2026-09-29T16:00:00Z", open(90, "2026-09-29T15:19:00Z"))).toBe(90);
    expect(amountAt("2026-09-29T14:00:00Z", open(null, null))).toBeNull();
  });
});
