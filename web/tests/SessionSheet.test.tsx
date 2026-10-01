import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionSheet } from "@/features/hall/SessionSheet";
import type { HallConsoleResponse } from "@/lib/api";

const NOW = Date.parse("2026-09-29T18:40:00Z");

function consoleWithDebt(): HallConsoleResponse {
  return {
    id: 2,
    zone_id: 1,
    name: "PS 2",
    is_active: true,
    charge_total: 390,
    paid_total: 150,
    balance: 240,
    session: {
      id: 12,
      console_id: 2,
      business_day_id: 1,
      kind: "paid",
      reason: null,
      status: "active",
      started_at: "2026-09-29T17:44:00Z",
      grace_until: "2026-09-29T17:47:00Z",
      ended_at: null,
      comment: null, game_id: null, game: null,
      segments: [
        { id: 1, tariff_id: 2, kind: "package", starts_at: "2026-09-29T17:44:00Z", ends_at: "2026-09-29T18:47:00Z", price_snapshot: 150, amount: 150 },
      ],
      orders: [
        { id: 1, session_id: 12, product_id: 1, qty: 1, unit_price: 60, created_at: "2026-09-29T18:00:00Z" },
        { id: 2, session_id: 12, product_id: 1, qty: 1, unit_price: 60, created_at: "2026-09-29T18:01:00Z" },
        { id: 3, session_id: 12, product_id: 2, qty: 1, unit_price: 120, created_at: "2026-09-29T18:02:00Z" },
      ],
      charge_total: 390,
      paid_total: 150,
      balance: 240,
    },
  };
}

function renderSheet(
  handlers: Partial<Record<"onPay" | "onExtend" | "onBar" | "onStop", () => void>> = {},
  stopping = false,
  game: string | null = null,
) {
  const consoleView = consoleWithDebt();
  consoleView.session!.game = game;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => [{ id: 2, zone_id: 1, kind: "package", name: "1 час", duration_min: 60, price: 150, hourly_rate: null, is_active: true }] })),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SessionSheet
        open
        onOpenChange={() => {}}
        consoleView={consoleView}
        nowMs={NOW}
        warnMinutes={5}
        productName={(id) => (id === 1 ? "Кола" : "Сэндвич")}
        onPay={handlers.onPay ?? vi.fn()}
        onExtend={handlers.onExtend ?? vi.fn()}
        onBar={handlers.onBar ?? vi.fn()}
        onStop={handlers.onStop ?? vi.fn()}
        stopping={stopping}
      />
    </QueryClientProvider>,
  );
}

describe("SessionSheet", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("names the game the guests said they would play, when there is one", () => {
    renderSheet({}, false, "FIFA 25");
    expect(screen.getByText("FIFA 25")).toBeInTheDocument();
  });

  it("says nothing about a game when none was recorded", () => {
    renderSheet();
    expect(screen.queryByText(/Играют/)).toBeNull();
  });

  it("shows the timeline, the bill and what the bar debt is made of", async () => {
    renderSheet();
    const sheet = screen.getByRole("dialog", { name: "PS 2" });

    expect(within(sheet).getByText("Выбор игры")).toBeInTheDocument();
    expect(await within(sheet).findByText("1 час")).toBeInTheDocument();
    expect(within(sheet).getByText("кола × 2, сэндвич")).toBeInTheDocument();
    expect(within(sheet).getByTestId("bill-due")).toHaveTextContent("240 сом");
  });

  it("offers payment and lets the operator stop a session that still owes money", () => {
    const onPay = vi.fn();
    const onStop = vi.fn();
    renderSheet({ onPay, onStop });

    fireEvent.click(screen.getByRole("button", { name: "Принять 240" }));
    fireEvent.click(screen.getByRole("button", { name: "Завершить сессию" }));
    expect(onPay).toHaveBeenCalled();
    expect(onStop).toHaveBeenCalled();
  });

  it("disables every action while a stop is in progress", () => {
    renderSheet({}, true);

    for (const name of ["Принять 240", "Продлить", "Добавить из бара", "Завершить сессию"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });

  it("routes extend and bar to their own sheets", () => {
    const onExtend = vi.fn();
    const onBar = vi.fn();
    renderSheet({ onExtend, onBar });

    fireEvent.click(screen.getByRole("button", { name: "Продлить" }));
    fireEvent.click(screen.getByRole("button", { name: "Добавить из бара" }));
    expect(onExtend).toHaveBeenCalled();
    expect(onBar).toHaveBeenCalled();
  });
});
