import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HallPage } from "@/features/hall/HallPage";
import { ThemeModeProvider } from "@/features/theme/ThemeModeProvider";
import type { HallConsoleResponse, HallSnapshotResponse } from "@/lib/api";

class SilentWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

type SegmentSpec = { kind: "package" | "open"; startsMinAgo: number; endsInMin: number | null; amount: number | null; rate: number };

function console1(opts: { segment: SegmentSpec; serverBalance: number; chargeTotal: number; paidTotal: number }): HallConsoleResponse {
  const now = Date.now();
  const { segment } = opts;
  return {
    id: 1,
    zone_id: 1,
    name: "PS5-1",
    is_active: true,
    charge_total: opts.chargeTotal,
    paid_total: opts.paidTotal,
    balance: opts.serverBalance,
    session: {
      id: 7,
      console_id: 1,
      business_day_id: 1,
      kind: "paid",
      reason: null,
      status: "active",
      started_at: new Date(now - (segment.startsMinAgo + 1) * 60_000).toISOString(),
      grace_until: new Date(now - segment.startsMinAgo * 60_000).toISOString(),
      ended_at: null,
      comment: null,
      game_id: null,
      game: null,
      segments: [
        {
          id: 1,
          tariff_id: 1,
          kind: segment.kind,
          starts_at: new Date(now - segment.startsMinAgo * 60_000).toISOString(),
          ends_at: segment.endsInMin === null ? null : new Date(now + segment.endsInMin * 60_000).toISOString(),
          price_snapshot: segment.rate,
          amount: segment.amount,
        },
      ],
      orders: [],
      charge_total: opts.chargeTotal,
      paid_total: opts.paidTotal,
      balance: opts.serverBalance,
    },
  };
}

// 1 h package, paid up front, 50 minutes still ahead
const PREPAID_RUNNING = console1({
  segment: { kind: "package", startsMinAgo: 10, endsInMin: 50, amount: 300, rate: 300 },
  serverBalance: 0,
  chargeTotal: 300,
  paidTotal: 300,
});
// package already over, nothing owed
const PACKAGE_OVER = console1({
  segment: { kind: "package", startsMinAgo: 70, endsInMin: -10, amount: 300, rate: 300 },
  serverBalance: 0,
  chargeTotal: 300,
  paidTotal: 300,
});
// open time running for an hour at 180/h, but the snapshot is stale: it still says nothing is owed
const OPEN_STALE = console1({
  segment: { kind: "open", startsMinAgo: 60, endsInMin: null, amount: null, rate: 180 },
  serverBalance: 0,
  chargeTotal: 0,
  paidTotal: 0,
});

function snapshot(consoles: HallConsoleResponse[]): HallSnapshotResponse {
  return { generated_at: new Date().toISOString(), business_day_open: true, business_day_id: 1, consoles, tickets: [] };
}

function stubApi(hall: HallSnapshotResponse) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === "/api/hall") return { ok: true, status: 200, json: async () => hall };
    if (url === "/api/settings") return { ok: true, status: 200, json: async () => ({ grace_minutes: 1, warn_minutes: 5 }) };
    if (url === "/api/sessions/7/stop") return { ok: true, status: 200, json: async () => ({ id: 7, status: "finished", balance: 0 }) };
    if (url === "/api/tickets") return { ok: true, status: 200, json: async () => ({ id: 9 }) };
    if (url === "/api/tariffs" || url === "/api/products") return { ok: true, status: 200, json: async () => [] };
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("WebSocket", SilentWebSocket as unknown as typeof WebSocket);
  return fetchMock;
}

function renderHall() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeModeProvider>
        <HallPage />
      </ThemeModeProvider>
    </QueryClientProvider>,
  );
}

const stopCalls = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls.filter(([url]) => url === "/api/sessions/7/stop");

describe("stopping a session is irreversible, so it asks first when paid time would be thrown away", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks before stopping a package that still has time left, and does nothing until confirmed", async () => {
    const fetchMock = stubApi(snapshot([PREPAID_RUNNING]));
    renderHall();
    await screen.findByRole("article", { name: "PS5-1" });

    fireEvent.click(screen.getByRole("button", { name: "Стоп" }));

    const dialog = await screen.findByRole("dialog", { name: "Остановить PS5-1?" });
    expect(dialog).toHaveTextContent(/осталось/i);
    expect(stopCalls(fetchMock)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Остановить" }));
    await waitFor(() => expect(stopCalls(fetchMock)).toHaveLength(1));
  });

  it("leaves the session running when the operator backs out", async () => {
    const fetchMock = stubApi(snapshot([PREPAID_RUNNING]));
    renderHall();
    await screen.findByRole("article", { name: "PS5-1" });
    fireEvent.click(screen.getByRole("button", { name: "Стоп" }));
    await screen.findByRole("dialog", { name: "Остановить PS5-1?" });

    fireEvent.click(screen.getByRole("button", { name: "Не останавливать" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Остановить PS5-1?" })).toBeNull());
    expect(stopCalls(fetchMock)).toHaveLength(0);
  });

  it("stops at once when the package is already over (nothing paid is lost)", async () => {
    const fetchMock = stubApi(snapshot([PACKAGE_OVER]));
    renderHall();
    await screen.findByRole("article", { name: "PS5-1" });

    fireEvent.click(screen.getByRole("button", { name: "Завершить" }));

    await waitFor(() => expect(stopCalls(fetchMock)).toHaveLength(1));
    expect(screen.queryByRole("dialog", { name: "Остановить PS5-1?" })).toBeNull();
  });
});

describe("walk-in sale button", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens one ticket however fast it is tapped", async () => {
    // A real double tap arrives while the first request is still on its way.
    const fetchMock = stubApi(snapshot([]));
    const baseImpl = fetchMock.getMockImplementation()!;
    let answerTicket: (response: unknown) => void = () => {};
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/tickets") return new Promise((resolve) => (answerTicket = resolve as (response: unknown) => void));
      return baseImpl(url, init);
    });
    renderHall();
    const button = await screen.findByRole("button", { name: "+ Продажа без игры" });

    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    fireEvent.click(button);

    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/tickets")).toHaveLength(1);
    answerTicket({ ok: true, status: 200, json: async () => ({ id: 9 }) });
  });
});

describe("payment for a running open-time session", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for what is owed right now, not for the figure in the last snapshot", async () => {
    stubApi(snapshot([OPEN_STALE]));
    renderHall();
    await screen.findByRole("article", { name: "PS5-1" });

    fireEvent.click(screen.getByRole("article", { name: "PS5-1" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Принять/ }));

    // an hour of open time at 180/h is owed even though the (stale) snapshot says 0
    expect(await screen.findByText(/Оплата · остаток 18\d сом/)).toBeInTheDocument();
  });
});
