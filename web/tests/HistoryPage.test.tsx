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
};

function renderPage(days: unknown[], onBack = vi.fn()) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/business-days?limit=30") return { ok: true, json: async () => days };
      if (url === "/api/business-days/3/summary") {
        return {
          ok: true,
          json: async () => ({
            opening_cash: 5000, cash_total: 300, qr_total: 200, transfer_total: 100, expected_cash: 5300,
            sessions_count: 2, minutes_total: 90, bar_sales_total: 160, has_active_sessions: false,
          }),
        };
      }
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

  it("lists a closed day with its cash reconciliation", async () => {
    renderPage([DAY, { ...DAY, id: 4, closed_at: null }]);
    const row = await screen.findByRole("button", { name: /чт, 24\.09/ });
    expect(row).toHaveTextContent("10:00 → 02:00");
    expect(row).toHaveTextContent("5 000");
    expect(row).toHaveTextContent("5 300");
    expect(row).toHaveTextContent("5 200");
    expect(row).toHaveTextContent("−100");
    expect(screen.getAllByRole("button", { name: /\d\d\.\d\d/ })).toHaveLength(1); // the open day is not listed
  });

  it("opens the day's breakdown with non-cash apart", async () => {
    renderPage([DAY]);
    fireEvent.click(await screen.findByRole("button", { name: /чт, 24\.09/ }));
    const sheet = await screen.findByRole("dialog", { name: "чт, 24.09" });
    await waitFor(() => expect(within(sheet).getByText("QR").closest("div")).toHaveTextContent("200"));
    expect(within(sheet).getByText("Перевод по номеру").closest("div")).toHaveTextContent("100");
    expect(within(sheet).getByText("Сессий").closest("div")).toHaveTextContent("2");
  });

  it("goes back to the hall", async () => {
    const onBack = renderPage([]);
    fireEvent.click(await screen.findByRole("button", { name: "← Зал" }));
    expect(onBack).toHaveBeenCalled();
  });
});
