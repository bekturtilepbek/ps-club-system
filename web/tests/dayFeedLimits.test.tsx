import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DayFeed } from "@/features/hall/DayFeed";
import { useHallSnapshot } from "@/features/hall/useHallSnapshot";

function events(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    at: new Date(Date.UTC(2026, 9, 3, 6, 0, 0) - index * 1000).toISOString(),
    kind: "order",
    session_id: 7,
    console_name: "PS5-1",
    session_kind: "paid",
    segment_kind: null,
    tariff_name: null,
    reason: null,
    product_name: "Кола",
    qty: 1,
    amount: 100,
    method: null,
    minutes: null,
  }));
}

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function renderFeed(snapshotAt = "2026-10-03T06:00:00Z") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <DayFeed businessDayId={1} snapshotAt={snapshotAt} />
    </QueryClientProvider>,
  );
  return { ...view, queryClient, rerenderAt: (at: string) =>
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <DayFeed businessDayId={1} snapshotAt={at} />
      </QueryClientProvider>,
    ) };
}

describe("the day's feed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("asks for the longest history the API allows", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(events(3)));
    vi.stubGlobal("fetch", fetchMock);

    renderFeed();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/business-days/1/feed?limit=500");
  });

  it("says so when older events were cut off, instead of silently showing a partial day", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(events(500))));

    renderFeed();

    expect(await screen.findByText(/Показаны последние 500 событий/)).toBeInTheDocument();
  });

  it("shows no such note for an ordinary day", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(events(40))));

    renderFeed();

    await screen.findByLabelText("Лента дня");
    expect(screen.queryByText(/Показаны последние/)).toBeNull();
  });

  it("refetches once after a burst of snapshots, not once per snapshot", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn().mockResolvedValue(ok(events(3)));
    vi.stubGlobal("fetch", fetchMock);
    const { rerenderAt } = renderFeed("2026-10-03T06:00:00Z");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    for (let second = 1; second <= 6; second += 1) {
      rerenderAt(`2026-10-03T06:00:0${second}Z`);
      await act(() => vi.advanceTimersByTimeAsync(50));
    }
    await act(() => vi.advanceTimersByTimeAsync(1000));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

describe("the day's totals after a burst of hall changes", () => {
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

  afterEach(() => {
    FakeWebSocket.instances = [];
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("are refreshed once, not once per pushed snapshot", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const snapshotAt = (second: number) => new Date(Date.UTC(2026, 9, 3, 6, 0, second)).toISOString();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(ok({ generated_at: snapshotAt(0), business_day_open: true, business_day_id: 1, consoles: [], tickets: [] })),
    );
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    renderHook(() => useHallSnapshot(), {
      wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    invalidate.mockClear();

    for (let second = 1; second <= 8; second += 1) {
      act(() =>
        FakeWebSocket.instances[0].onmessage?.({
          data: JSON.stringify({ generated_at: snapshotAt(second), business_day_open: true, business_day_id: 1, consoles: [], tickets: [] }),
        }),
      );
      await act(() => vi.advanceTimersByTimeAsync(40));
    }
    await act(() => vi.advanceTimersByTimeAsync(1000));

    const summaryRefreshes = invalidate.mock.calls.filter(
      ([filters]) => (filters as { queryKey?: unknown[] })?.queryKey?.[0] === "business-day-summary",
    );
    expect(summaryRefreshes).toHaveLength(1);
  });
});
