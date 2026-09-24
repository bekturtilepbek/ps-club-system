import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HallPage } from "@/features/hall/HallPage";
import { HALL_QUERY_KEY } from "@/features/hall/useHallSnapshot";
import type { HallConsoleResponse, HallSnapshotResponse } from "@/lib/api";

class SilentWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

function freeConsole(id: number): HallConsoleResponse {
  return { id, zone_id: 1, name: `PS5-${id}`, is_active: true, session: null, charge_total: 0, paid_total: 0, balance: 0 };
}

function paidConsole(id: number, sessionId: number, balance: number): HallConsoleResponse {
  const now = Date.now();
  return {
    id,
    zone_id: 1,
    name: `PS5-${id}`,
    is_active: true,
    session: {
      id: sessionId,
      kind: "paid",
      reason: null,
      status: "active",
      started_at: new Date(now - 10 * 60_000).toISOString(),
      grace_until: new Date(now - 7 * 60_000).toISOString(),
      segments: [
        {
          id: 1,
          tariff_id: 1,
          kind: "package",
          starts_at: new Date(now - 10 * 60_000).toISOString(),
          ends_at: new Date(now + 50 * 60_000).toISOString(),
          price_snapshot: 300,
          amount: 300,
        },
      ],
    },
    charge_total: 300,
    paid_total: 300 - balance,
    balance,
  };
}

function snapshot(consoles: HallConsoleResponse[]): HallSnapshotResponse {
  return { generated_at: new Date().toISOString(), business_day_open: true, consoles };
}

function stubApi(hall: HallSnapshotResponse | "pending") {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/hall") {
      if (hall === "pending") return new Promise(() => {});
      return { ok: true, json: async () => hall };
    }
    if (url === "/api/settings") return { ok: true, json: async () => ({ grace_minutes: 3, warn_minutes: 5 }) };
    if (url === "/api/tariffs") return { ok: true, json: async () => [] };
    if (url === "/api/auth/logout") return { ok: true, json: async () => ({ authenticated: false }) };
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderHall() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <HallPage />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("HallPage", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", SilentWebSocket as unknown as typeof WebSocket);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("does not prompt to open the business day before the first snapshot arrives", async () => {
    stubApi("pending");
    renderHall();

    expect(screen.getByTestId("hall-page")).toBeInTheDocument();
    expect(screen.getByText("Загрузка…")).toBeInTheDocument();
    expect(screen.queryByText("День не открыт. Открыть?")).not.toBeInTheDocument();
  });

  it("keeps the header and logout button above the open-day prompt", async () => {
    const fetchMock = stubApi({ ...snapshot([freeConsole(1)]), business_day_open: false });
    renderHall();

    await waitFor(() => expect(screen.getByText("День не открыт. Открыть?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Выйти" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === "/api/auth/logout")).toBe(true),
    );
  });

  it("starts a session on the console whose card was clicked", async () => {
    const fetchMock = stubApi(snapshot([freeConsole(1), freeConsole(2)]));
    renderHall();

    await waitFor(() => expect(screen.getByText("PS5-2")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Старт" })[1]);
    await waitFor(() => expect(screen.getByText("Начать сессию")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Служебная" }));
    fireEvent.click(screen.getByRole("button", { name: "Начать" }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls as unknown as [string, RequestInit | undefined][];
      const startCall = calls.find(([url]) => url === "/api/sessions");
      expect(JSON.parse(startCall![1]!.body as string)).toMatchObject({ console_id: 2, kind: "service" });
    });
  });

  it("keeps the payment dialog's balance in sync with the live snapshot", async () => {
    stubApi(snapshot([paidConsole(1, 7, 300)]));
    const queryClient = renderHall();

    await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Оплата" }));
    await waitFor(() => expect(screen.getByText("Оплата — остаток 300 сом")).toBeInTheDocument());

    // A split payment lands; the next snapshot carries the reduced balance.
    act(() => {
      queryClient.setQueryData(HALL_QUERY_KEY, snapshot([paidConsole(1, 7, 100)]));
    });
    await waitFor(() => expect(screen.getByText("Оплата — остаток 100 сом")).toBeInTheDocument());
  });

  it("stops the clicked session and reports a failed stop to the operator", async () => {
    const fetchMock = stubApi(snapshot([paidConsole(1, 7, 0)]));
    const baseImpl = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/sessions/7/stop") {
        return { ok: false, status: 409, json: async () => ({ detail: "session 7 is not active" }) };
      }
      return baseImpl(url);
    });
    renderHall();

    await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Стоп" }));

    await waitFor(() =>
      expect(screen.getByText("Не удалось выполнить действие. Попробуйте ещё раз.")).toBeInTheDocument(),
    );
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/sessions/7/stop")).toBe(true);
  });

  describe("settling a stopped session", () => {
    // Stopping finishes the session, so it drops out of the hall snapshot; the
    // final balance only exists in the stop response itself.
    function stubStop(stopBalance: number) {
      let hall = snapshot([paidConsole(1, 7, 300)]);
      const fetchMock = vi.fn(async (url: string) => {
        if (url === "/api/hall") return { ok: true, json: async () => hall };
        if (url === "/api/settings") return { ok: true, json: async () => ({ grace_minutes: 3, warn_minutes: 5 }) };
        if (url === "/api/sessions/7/stop") {
          hall = snapshot([freeConsole(1)]);
          return { ok: true, json: async () => ({ id: 7, status: "finished", balance: stopBalance }) };
        }
        if (url === "/api/sessions/7/payments") return { ok: true, json: async () => ({ id: 1 }) };
        return { ok: true, json: async () => ({}) };
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    it("opens the payment dialog with the final balance after a stop, even once the session leaves the hall", async () => {
      stubStop(150);
      const queryClient = renderHall();

      await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Стоп" }));

      await waitFor(() => expect(screen.getByText("Оплата — остаток 150 сом")).toBeInTheDocument());
      await waitFor(() => expect(screen.getByText("Свободна")).toBeInTheDocument());
      act(() => {
        queryClient.setQueryData(HALL_QUERY_KEY, snapshot([freeConsole(1)]));
      });
      expect(screen.getByText("Оплата — остаток 150 сом")).toBeInTheDocument();
    });

    it("tracks the remaining balance across a split settlement and closes once it is paid off", async () => {
      const fetchMock = stubStop(150);
      renderHall();

      await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Стоп" }));
      await waitFor(() => expect(screen.getByText("Оплата — остаток 150 сом")).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "100" } });
      fireEvent.click(screen.getByRole("button", { name: "Внести" }));
      await waitFor(() => expect(screen.getByText("Оплата — остаток 50 сом")).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "50" } });
      fireEvent.click(screen.getByRole("button", { name: "QR" }));
      fireEvent.click(screen.getByRole("button", { name: "Внести" }));
      await waitFor(() => expect(screen.queryByText(/Оплата — остаток/)).not.toBeInTheDocument());

      const calls = fetchMock.mock.calls as unknown as [string, RequestInit | undefined][];
      const payments = calls
        .filter(([url]) => url === "/api/sessions/7/payments")
        .map(([, init]) => JSON.parse(init!.body as string));
      expect(payments).toEqual([
        { amount: 100, method: "cash" },
        { amount: 50, method: "qr" },
      ]);
    });

    it("does not open the payment dialog when the stopped session is already paid", async () => {
      const fetchMock = stubStop(0);
      renderHall();

      await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Стоп" }));

      await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/sessions/7/stop")).toBe(true));
      await waitFor(() => expect(screen.getByText("Свободна")).toBeInTheDocument());
      expect(screen.queryByText(/Оплата — остаток/)).not.toBeInTheDocument();
    });
  });

  it("closes the payment dialog when its session leaves the hall", async () => {
    stubApi(snapshot([paidConsole(1, 7, 300)]));
    const queryClient = renderHall();

    await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Оплата" }));
    await waitFor(() => expect(screen.getByText("Оплата — остаток 300 сом")).toBeInTheDocument());

    act(() => {
      queryClient.setQueryData(HALL_QUERY_KEY, snapshot([freeConsole(1)]));
    });
    await waitFor(() => expect(screen.queryByText(/Оплата — остаток/)).not.toBeInTheDocument());
  });
});
