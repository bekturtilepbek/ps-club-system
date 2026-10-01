import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Till } from "@/features/hall/Till";
import { useHallSnapshot } from "@/features/hall/useHallSnapshot";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close() {}
}

function snapshot(generatedAt: string) {
  return { generated_at: generatedAt, business_day_open: true, business_day_id: 1, consoles: [] };
}

function TillWithHall() {
  useHallSnapshot();
  return <Till businessDayId={1} />;
}

describe("Till", () => {
  afterEach(() => {
    cleanup();
    FakeWebSocket.instances = [];
    vi.unstubAllGlobals();
  });

  it("refetches the day summary when a new hall snapshot arrives, under one stable query key", async () => {
    let cash = 5000;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/hall") return { ok: true, json: async () => snapshot("2026-09-29T10:00:00Z") };
      if (url.endsWith("/summary")) {
        return {
          ok: true,
          json: async () => ({
            opening_cash: 5000, cash_total: cash - 5000, transfer_total: 0, expected_cash: cash,
            sessions_count: 0, minutes_total: 0, bar_sales_total: 0, has_active_sessions: false,
          }),
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <TillWithHall />
      </QueryClientProvider>,
    );

    const till = await screen.findByRole("region", { name: "Касса дня" });
    expect(till).toHaveTextContent(/5\s000/);

    cash = 5300;
    act(() => {
      FakeWebSocket.instances[0].onmessage?.({ data: JSON.stringify(snapshot("2026-09-29T10:00:05Z")) });
    });

    await waitFor(() => expect(screen.getByRole("region", { name: "Касса дня" })).toHaveTextContent(/5\s300/));
    const tillKeys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey)
      .filter((key) => key[0] === "business-day-summary");
    expect(tillKeys).toEqual([["business-day-summary", 1, "till"]]);
  });
});
