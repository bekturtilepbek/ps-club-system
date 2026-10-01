import { describe, expect, it } from "vitest";
import { describeFeedEvent } from "@/features/hall/feedModel";
import type { FeedEventResponse } from "@/lib/api";

function event(overrides: Partial<FeedEventResponse>): FeedEventResponse {
  return {
    at: "2026-09-29T18:38:00Z",
    kind: "session_started",
    session_id: 7,
    console_name: "PS 1",
    session_kind: "paid",
    segment_kind: "package",
    tariff_name: "3 часа",
    reason: null,
    product_name: null,
    qty: null,
    amount: null,
    method: null,
    minutes: null,
    ...overrides,
  };
}

describe("describeFeedEvent", () => {
  it("names a package start by its tariff", () => {
    expect(describeFeedEvent(event({}))).toMatchObject({ glyph: "✕", tone: "cross", who: "PS 1", what: "пакет 3 часа", amount: null });
  });

  it("shows why a session is free", () => {
    expect(describeFeedEvent(event({ session_kind: "free", reason: "друзья владельца" }))).toMatchObject({
      glyph: "□",
      what: "бесплатно: «друзья владельца»",
    });
  });

  it("describes a payment by method, and a ticket by its number", () => {
    const line = describeFeedEvent(event({ kind: "payment", console_name: null, session_id: 214, amount: 150, method: "transfer" }));
    expect(line).toMatchObject({ who: "Чек №214", what: "оплата", amount: 150, method: "перевод" });
  });

  it("describes bar orders and finished sessions", () => {
    expect(describeFeedEvent(event({ kind: "order", product_name: "Кола", qty: 2, amount: 120 })).what).toBe("кола × 2");
    expect(describeFeedEvent(event({ kind: "session_finished", minutes: 130 })).what).toBe("завершена, 2 ч 10 мин");
    expect(describeFeedEvent(event({ kind: "session_extended", segment_kind: "open" })).what).toBe("переход на открытое время");
  });
});
