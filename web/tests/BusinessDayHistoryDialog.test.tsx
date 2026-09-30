import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusinessDayHistoryDialog } from "@/features/hall/BusinessDayHistoryDialog";

function renderDialog() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <BusinessDayHistoryDialog open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe("BusinessDayHistoryDialog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a message when there are no closed days yet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    renderDialog();

    await waitFor(() => expect(screen.getByText("Закрытых дней пока нет.")).toBeInTheDocument());
  });

  it("lists closed days with their cash reconciliation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: 3,
            opened_at: "2026-09-24T04:00:00Z",
            closed_at: "2026-09-24T20:00:00Z",
            opening_cash: 5000,
            expected_cash: 5300,
            counted_cash: 5200,
          },
        ],
      }),
    );
    renderDialog();

    await waitFor(() =>
      expect(
        screen.getByText(/Начало: 5 000 сом · Ожидалось: 5 300 сом · Посчитано: 5 200 сом/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/Расхождение: −100 сом/)).toBeInTheDocument();
  });

  it("excludes any still-open day from the list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { id: 4, opened_at: "2026-09-25T04:00:00Z", closed_at: null, opening_cash: 1000, expected_cash: null, counted_cash: null },
        ],
      }),
    );
    renderDialog();

    await waitFor(() => expect(screen.getByText("Закрытых дней пока нет.")).toBeInTheDocument());
  });
});
