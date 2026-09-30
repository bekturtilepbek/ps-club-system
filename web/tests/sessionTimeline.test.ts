import { describe, expect, it } from "vitest";
import { sessionTimeline } from "@/features/hall/sessionTimeline";
import type { SessionResponse } from "@/lib/api";

function session(overrides: Partial<SessionResponse>): SessionResponse {
  return {
    id: 7,
    console_id: 3,
    business_day_id: 1,
    kind: "paid",
    reason: null,
    status: "active",
    started_at: "2026-09-29T14:31:00Z",
    grace_until: "2026-09-29T14:34:00Z",
    ended_at: null,
    comment: null,
    segments: [],
    orders: [],
    charge_total: 0,
    paid_total: 0,
    balance: 0,
    ...overrides,
  };
}

const tariffName = (id: number | null) => ({ 1: "3 часа", 2: "1 час" } as Record<number, string>)[id ?? 0];

describe("sessionTimeline", () => {
  it("lists grace, the package, an extension and a running overtime", () => {
    const rows = sessionTimeline(
      session({
        segments: [
          { id: 1, tariff_id: 1, kind: "package", starts_at: "2026-09-29T14:31:00Z", ends_at: "2026-09-29T17:34:00Z", price_snapshot: 400, amount: 400 },
          { id: 2, tariff_id: 2, kind: "package", starts_at: "2026-09-29T17:34:00Z", ends_at: "2026-09-29T18:34:00Z", price_snapshot: 150, amount: 150 },
        ],
      }),
      tariffName,
      Date.parse("2026-09-29T18:40:00Z"),
    );

    expect(rows.map((row) => row.title)).toEqual(["Выбор игры", "3 часа", "Продление: 1 час", "Переигрыш"]);
    expect(rows[1]).toMatchObject({ note: "до 23:34", amount: 400, tone: "cross" });
    expect(rows[3]).toMatchObject({ tone: "circle", amount: null });
  });

  it("marks a running open segment and shows its hourly rate", () => {
    const rows = sessionTimeline(
      session({
        segments: [{ id: 3, tariff_id: null, kind: "open", starts_at: "2026-09-29T17:50:00Z", ends_at: null, price_snapshot: 160, amount: null }],
      }),
      tariffName,
      Date.parse("2026-09-29T18:40:00Z"),
    );
    expect(rows[1]).toMatchObject({ title: "Открытое время", note: "160 сом/ч · идёт", tone: "triangle" });
  });

  it("shows a free session by its reason instead of segments", () => {
    const rows = sessionTimeline(session({ kind: "free", reason: "друзья владельца", grace_until: null }), tariffName, 0);
    expect(rows).toEqual([expect.objectContaining({ title: "Бесплатная", note: "«друзья владельца»", tone: "square" })]);
  });

  it("marks a queued open segment as not started yet", () => {
    const rows = sessionTimeline(
      session({
        segments: [
          { id: 1, tariff_id: 1, kind: "package", starts_at: "2026-09-29T14:31:00Z", ends_at: "2026-09-29T17:34:00Z", price_snapshot: 400, amount: 400 },
          { id: 2, tariff_id: null, kind: "open", starts_at: "2026-09-29T17:34:00Z", ends_at: null, price_snapshot: 160, amount: null },
        ],
      }),
      tariffName,
      Date.parse("2026-09-29T16:00:00Z"),
    );
    expect(rows.map((row) => row.title)).toEqual(["Выбор игры", "3 часа", "Открытое время"]);
    expect(rows[2]).toMatchObject({ note: "160 сом/ч, с 23:34", tone: "triangle" });
  });
});
