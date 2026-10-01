import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConsoleCard } from "@/features/hall/ConsoleCard";
import type { HallConsoleResponse } from "@/lib/api";

const NOW = Date.parse("2026-09-29T18:40:00Z"); // 00:40 in Bishkek

function busy(overrides: { balance?: number; endsInMs?: number; graceLeftMs?: number; withBar?: boolean } = {}): HallConsoleResponse {
  const { balance = 0, endsInMs = 60 * 60_000, graceLeftMs = -60_000, withBar = false } = overrides;
  const orders = withBar
    ? [
        { id: 1, session_id: 7, product_id: 1, qty: 1, unit_price: 60, created_at: "2026-09-29T18:00:00Z" },
        { id: 2, session_id: 7, product_id: 1, qty: 1, unit_price: 60, created_at: "2026-09-29T18:01:00Z" },
      ]
    : [];
  const charge = 300 + orders.length * 60;
  return {
    id: 1,
    zone_id: 1,
    name: "PS5-1",
    is_active: true,
    charge_total: charge,
    paid_total: charge - balance,
    balance,
    session: {
      id: 7,
      console_id: 1,
      business_day_id: 1,
      kind: "paid",
      reason: null,
      status: "active",
      started_at: new Date(NOW - 20 * 60_000).toISOString(),
      grace_until: new Date(NOW + graceLeftMs).toISOString(),
      ended_at: null,
      comment: null,
      segments: [
        {
          id: 1,
          tariff_id: 1,
          kind: "package",
          starts_at: new Date(NOW - 20 * 60_000).toISOString(),
          ends_at: new Date(NOW + endsInMs).toISOString(),
          price_snapshot: 300,
          amount: 300,
        },
      ],
      orders,
      charge_total: charge,
      paid_total: charge - balance,
      balance,
    },
  };
}

const FREE: HallConsoleResponse = { id: 2, zone_id: 1, name: "PS5-2", is_active: true, session: null, charge_total: 0, paid_total: 0, balance: 0 };

function renderCard(consoleView: HallConsoleResponse) {
  const handlers = {
    onOpen: vi.fn(), onStart: vi.fn(), onExtend: vi.fn(), onStop: vi.fn(),
    onCancel: vi.fn(), onPay: vi.fn(), onBar: vi.fn(),
  };
  render(
    <ConsoleCard console={consoleView} nowMs={NOW} warnMinutes={5} hotkey={1} productName={() => "Кола"} {...handlers} />,
  );
  return handlers;
}

describe("ConsoleCard", () => {
  it("offers one big start button on a free console, and names it once", () => {
    const handlers = renderCard(FREE);
    expect(screen.getAllByText("Свободна")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Начать сессию" }));
    expect(handlers.onStart).toHaveBeenCalled();
    expect(handlers.onOpen).not.toHaveBeenCalled();
  });

  it("puts the money due on the primary button and keeps the click off the card", () => {
    const handlers = renderCard(busy({ balance: 300 }));
    expect(screen.getByText("1:00:00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Принять 300" }));
    expect(handlers.onPay).toHaveBeenCalled();
    expect(handlers.onOpen).not.toHaveBeenCalled();
  });

  it("opens the details when the card itself is clicked", () => {
    const handlers = renderCard(busy());
    fireEvent.click(screen.getByRole("article", { name: "PS5-1" }));
    expect(handlers.onOpen).toHaveBeenCalled();
  });

  it("offers no free cancel once a bar item is on the tab", () => {
    renderCard(busy({ graceLeftMs: 90_000, withBar: true }));
    expect(screen.getByText("01:30")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Отменить без оплаты" })).toBeNull();
  });

  it("cancels for free during the grace period", () => {
    const handlers = renderCard(busy({ graceLeftMs: 90_000 }));
    expect(screen.getByText("01:30")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отменить без оплаты" }));
    expect(handlers.onCancel).toHaveBeenCalled();
  });

  it("shows overtime loudly with the manual TV reminder", () => {
    renderCard(busy({ endsInMs: -6 * 60_000 - 15_000 }));
    const card = screen.getByRole("article", { name: "PS5-1" });
    expect(card).toHaveAttribute("data-status", "package_overtime");
    expect(screen.getByText("+06:15")).toBeInTheDocument();
    expect(screen.getByText(/Выключите ТВ на/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Продлить" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Завершить" })).toBeInTheDocument();
  });

  it("says what an unpaid bar tab is made of", () => {
    renderCard(busy({ balance: 120, withBar: true }));
    expect(screen.getByText("Не оплачен бар: кола × 2")).toBeInTheDocument();
  });

  it("says how long a free console has been idle", () => {
    renderCard({ ...FREE, free_since: new Date(NOW - 43 * 60_000).toISOString() });
    expect(screen.getByText((_, element) => {
      return element?.textContent === "с 23:57 · простой 43 мин";
    })).toBeInTheDocument();
  });
});
