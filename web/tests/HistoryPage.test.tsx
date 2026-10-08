import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryPage } from "@/features/hall/HistoryPage";

const DAY = {
  id: 3,
  opened_at: "2026-09-24T04:00:00Z", // Thursday 10:00 in Bishkek
  closed_at: "2026-09-24T20:00:00Z", // 02:00 next night
  opening_cash: 5000,
  expected_cash: 5300,
  counted_cash: 5200,
  cash_total: 300,
  transfer_total: 450,
  revenue_total: 750,
  sessions_count: 27,
  minutes_total: 2290,
  free_minutes_total: 80,
  bar_sales_total: 860,
};

function renderPage(days: unknown[], onBack = vi.fn()) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/business-days?limit=30") return { ok: true, json: async () => days };
      return { ok: true, json: async () => ({}) };
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HistoryPage onBack={onBack} />
    </QueryClientProvider>,
  );
  return onBack;
}

describe("HistoryPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("says so when no day has been closed yet", async () => {
    renderPage([]);
    await waitFor(() => expect(screen.getByText("Закрытых дней пока нет.")).toBeInTheDocument());
  });

  it("lists a closed day with cash and non-cash apart", async () => {
    renderPage([DAY, { ...DAY, id: 4, closed_at: null }]);
    const row = await screen.findByRole("button", { name: /чт, 24\.09/ });
    expect(row).toHaveTextContent("10:00 → 02:00");
    expect(row).toHaveTextContent("750"); // revenue: cash 300 + transfer 450
    expect(row).toHaveTextContent("450"); // transfer
    expect(row).toHaveTextContent("−100");
    expect(row).toHaveTextContent("38:10");
    expect(screen.getAllByRole("button", { name: /\d\d\.\d\d/ })).toHaveLength(1);
  });

  it("totals the period with each payment method on its own", async () => {
    renderPage([DAY, { ...DAY, id: 5, opened_at: "2026-09-23T04:00:00Z", closed_at: "2026-09-23T20:00:00Z", counted_cash: 5300 }]);
    const totals = await screen.findByRole("region", { name: "Итого за период" });
    expect(within(totals).getByText("Выручка за период")).toBeInTheDocument();
    expect(within(totals).getByText("1 500 сом")).toBeInTheDocument(); // revenue 750 × 2
    expect(within(totals).getByText("900 сом")).toBeInTheDocument(); // transfer 450 × 2
  });

  it("opens the day's breakdown, free hours included", async () => {
    renderPage([DAY]);
    fireEvent.click(await screen.findByRole("button", { name: /чт, 24\.09/ }));
    const sheet = await screen.findByRole("dialog", { name: "чт, 24.09" });
    expect(within(sheet).getByText("Всего за день").closest("div")).toHaveTextContent("750");
    expect(within(sheet).getByText("Перевод").closest("div")).toHaveTextContent("450");
    expect(within(sheet).getByText("Бесплатно").closest("div")).toHaveTextContent("1 ч 20 мин");
  });

  it("goes back to the hall", async () => {
    const onBack = renderPage([]);
    fireEvent.click(await screen.findByRole("button", { name: "← Зал" }));
    expect(onBack).toHaveBeenCalled();
  });
});
