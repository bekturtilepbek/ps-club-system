import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HallPage } from "@/features/hall/HallPage";
import { ThemeModeProvider } from "@/features/theme/ThemeModeProvider";
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
      console_id: id,
      business_day_id: 1,
      kind: "paid",
      reason: null,
      status: "active",
      started_at: new Date(now - 10 * 60_000).toISOString(),
      grace_until: new Date(now - 7 * 60_000).toISOString(),
      ended_at: null,
      comment: null,
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
      orders: [],
      charge_total: 300,
      paid_total: 300 - balance,
      balance,
    },
    charge_total: 300,
    paid_total: 300 - balance,
    balance,
  };
}

function ticket(id: number, balance: number, orders: HallSnapshotResponse["tickets"][number]["orders"] = []): HallSnapshotResponse["tickets"][number] {
  const now = new Date().toISOString();
  return {
    id,
    console_id: null,
    business_day_id: 1,
    kind: "paid",
    reason: null,
    status: "active",
    started_at: now,
    grace_until: null, // a ticket has no grace period (Task 4)
    ended_at: null,
    comment: null,
    segments: [],
    orders,
    charge_total: orders.reduce((sum, o) => sum + o.qty * o.unit_price, 0),
    paid_total: orders.reduce((sum, o) => sum + o.qty * o.unit_price, 0) - balance,
    balance,
  };
}

function snapshot(
  consoles: HallConsoleResponse[],
  tickets: HallSnapshotResponse["tickets"] = [],
): HallSnapshotResponse {
  return {
    generated_at: new Date().toISOString(),
    business_day_open: true,
    business_day_id: 1,
    consoles,
    tickets,
  };
}

function stubApi(hall: HallSnapshotResponse | "pending") {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/hall") {
      if (hall === "pending") return new Promise(() => {});
      return { ok: true, json: async () => hall };
    }
    if (url === "/api/settings") return { ok: true, json: async () => ({ grace_minutes: 3, warn_minutes: 5 }) };
    if (url === "/api/tariffs") return { ok: true, json: async () => [] };
    if (url === "/api/products") return { ok: true, json: async () => [] };
    if (url === "/api/auth/logout") return { ok: true, json: async () => ({ authenticated: false }) };
    if (url.endsWith("/summary")) {
      return {
        ok: true,
        json: async () => ({
          opening_cash: 5000, cash_total: 0, qr_total: 0, transfer_total: 0, expected_cash: 5000,
          sessions_count: 0, minutes_total: 0, bar_sales_total: 0, has_active_sessions: false,
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderHall() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeModeProvider>
        <HallPage />
      </ThemeModeProvider>
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
    fireEvent.click(screen.getAllByRole("button", { name: "Начать сессию" })[1]);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Служебная" }));
    fireEvent.click(screen.getByRole("button", { name: /^Начать на/ }));

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
    fireEvent.click(screen.getByRole("button", { name: "Принять 300" }));
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

  it("shows the day's till with cash and non-cash apart", async () => {
    const fetchMock = stubApi(snapshot([freeConsole(1)]));
    const baseImpl = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/summary")) {
        return {
          ok: true,
          json: async () => ({
            opening_cash: 2000, cash_total: 3830, qr_total: 2150, transfer_total: 600, expected_cash: 5830,
            sessions_count: 23, minutes_total: 1900, bar_sales_total: 690, has_active_sessions: true,
          }),
        };
      }
      return baseImpl(url);
    });
    renderHall();

    const till = await screen.findByRole("region", { name: "Касса дня" });
    await waitFor(() => expect(within(till).getByText("5 830")).toBeInTheDocument());
    expect(within(till).getByText("2 150")).toBeInTheDocument();
    expect(within(till).getByText("600")).toBeInTheDocument();
    expect(within(till).getByText("23 сессии · 31 ч 40 мин · бар 690")).toBeInTheDocument();
  });

  it("counts consoles that need a decision", async () => {
    const overtime = paidConsole(1, 7, 0);
    overtime.session!.segments[0].ends_at = new Date(Date.now() - 60_000).toISOString();
    stubApi(snapshot([overtime, freeConsole(2)]));
    renderHall();

    await waitFor(() => expect(screen.getByText("ждут решения")).toBeInTheDocument());
    expect(screen.getByText("ждут решения").parentElement).toHaveTextContent("1 ждут решения");
    expect(screen.getByText("заняты").parentElement).toHaveTextContent("1 из 2 заняты");
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
      fireEvent.click(screen.getByRole("article", { name: "PS5-1" }));
      fireEvent.click(await screen.findByRole("button", { name: "Завершить сессию" }));

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
      fireEvent.click(screen.getByRole("article", { name: "PS5-1" }));
      fireEvent.click(await screen.findByRole("button", { name: "Завершить сессию" }));
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

    it("leaves no panel open after a fully paid stop, even when a new session starts on the console", async () => {
      stubStop(0);
      const queryClient = renderHall();

      await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("article", { name: "PS5-1" }));
      fireEvent.click(await screen.findByRole("button", { name: "Завершить сессию" }));
      await waitFor(() => expect(screen.getByText("Свободна")).toBeInTheDocument());
      expect(screen.queryByRole("dialog")).toBeNull();

      act(() => {
        queryClient.setQueryData(HALL_QUERY_KEY, snapshot([paidConsole(1, 8, 0)]));
      });
      await waitFor(() => expect(screen.queryByText("Свободна")).not.toBeInTheDocument());
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("does not open the payment dialog when the stopped session is already paid", async () => {
      const fetchMock = stubStop(0);
      renderHall();

      await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("article", { name: "PS5-1" }));
      fireEvent.click(await screen.findByRole("button", { name: "Завершить сессию" }));

      await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/sessions/7/stop")).toBe(true));
      await waitFor(() => expect(screen.getByText("Свободна")).toBeInTheDocument());
      expect(screen.queryByText(/Оплата — остаток/)).not.toBeInTheDocument();
    });
  });

  it("closes the payment dialog when its session leaves the hall", async () => {
    stubApi(snapshot([paidConsole(1, 7, 300)]));
    const queryClient = renderHall();

    await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Принять 300" }));
    await waitFor(() => expect(screen.getByText("Оплата — остаток 300 сом")).toBeInTheDocument());

    act(() => {
      queryClient.setQueryData(HALL_QUERY_KEY, snapshot([freeConsole(1)]));
    });
    await waitFor(() => expect(screen.queryByText(/Оплата — остаток/)).not.toBeInTheDocument());
  });

  it("opens the settle dialog when cancelling a session with an unpaid bar tab", async () => {
    const now = Date.now();
    const withinGraceConsole = paidConsole(1, 7, 300);
    withinGraceConsole.session!.grace_until = new Date(now + 60_000).toISOString();
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/hall") return { ok: true, json: async () => snapshot([withinGraceConsole]) };
      if (url === "/api/settings") return { ok: true, json: async () => ({ grace_minutes: 3, warn_minutes: 5 }) };
      if (url === "/api/products") return { ok: true, json: async () => [] };
      if (url === "/api/sessions/7/cancel") {
        return { ok: true, json: async () => ({ id: 7, status: "cancelled", balance: 80 }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    renderHall();

    await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Отменить без оплаты" }));

    await waitFor(() => expect(screen.getByText("Оплата — остаток 80 сом")).toBeInTheDocument());
  });

  it("opens the session details when a busy card is clicked", async () => {
    stubApi(snapshot([paidConsole(1, 7, 300)]));
    renderHall();

    await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("article", { name: "PS5-1" }));
    const sheet = await screen.findByRole("dialog", { name: "PS5-1" });
    expect(within(sheet).getByText("Отрезки")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Принять 300" }));
    await waitFor(() => expect(screen.getByText("Оплата — остаток 300 сом")).toBeInTheDocument());
  });

  it("does not open anything for a console under maintenance", async () => {
    stubApi(snapshot([{ ...freeConsole(1), is_active: false }]));
    renderHall();

    await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("article", { name: "PS5-1" }));
    fireEvent.keyDown(window, { key: "1" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the bar dialog for a console session", async () => {
    stubApi(snapshot([paidConsole(1, 7, 300)]));
    renderHall();

    await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Бар" }));
    await waitFor(() => expect(screen.getByText("Бар — на счету 0 сом")).toBeInTheDocument());
  });

  describe("продажа без игры", () => {
    it("opens a new ticket's bar dialog right after creating it", async () => {
      let hall = snapshot([]);
      const fetchMock = vi.fn(async (url: string) => {
        if (url === "/api/hall") return { ok: true, json: async () => hall };
        if (url === "/api/settings") return { ok: true, json: async () => ({ grace_minutes: 3, warn_minutes: 5 }) };
        if (url === "/api/products") return { ok: true, json: async () => [] };
        if (url === "/api/tickets") {
          const created = ticket(9, 0);
          hall = snapshot([], [created]);
          return { ok: true, json: async () => created };
        }
        return { ok: true, json: async () => ({}) };
      });
      vi.stubGlobal("fetch", fetchMock);
      renderHall();

      await waitFor(() => expect(screen.getByRole("button", { name: "+ Продажа без игры" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "+ Продажа без игры" }));

      await waitFor(() => expect(screen.getByText("Бар — на счету 0 сом")).toBeInTheDocument());
    });

    it("shows an error when creating a new ticket fails", async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url === "/api/hall") return { ok: true, json: async () => snapshot([]) };
        if (url === "/api/settings") return { ok: true, json: async () => ({ grace_minutes: 3, warn_minutes: 5 }) };
        if (url === "/api/products") return { ok: true, json: async () => [] };
        if (url === "/api/tickets") return { ok: false, status: 409, json: async () => ({ detail: "no open business day" }) };
        return { ok: true, json: async () => ({}) };
      });
      vi.stubGlobal("fetch", fetchMock);
      renderHall();

      await waitFor(() => expect(screen.getByRole("button", { name: "+ Продажа без игры" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "+ Продажа без игры" }));

      await waitFor(() =>
        expect(screen.getByText("Не удалось выполнить действие. Попробуйте ещё раз.")).toBeInTheDocument(),
      );
    });

    it("lets the operator pay off an open ticket", async () => {
      stubApi(snapshot([], [ticket(9, 150)]));
      renderHall();

      await waitFor(() => expect(screen.getByText("№9")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Принять 150" }));

      await waitFor(() => expect(screen.getByText("Оплата — остаток 150 сом")).toBeInTheDocument());
    });

    it("finishes a fully paid ticket", async () => {
      const fetchMock = stubApi(snapshot([], [ticket(9, 0)]));
      renderHall();

      await waitFor(() => expect(screen.getByText("№9")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Завершить" }));

      await waitFor(() =>
        expect(fetchMock.mock.calls.some(([url]) => url === "/api/sessions/9/stop")).toBe(true),
      );
    });

    it("allows finishing an overpaid ticket (negative balance)", async () => {
      const fetchMock = stubApi(snapshot([], [ticket(9, -20)]));
      renderHall();

      await waitFor(() => expect(screen.getByText("№9")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Завершить" }));

      await waitFor(() =>
        expect(fetchMock.mock.calls.some(([url]) => url === "/api/sessions/9/stop")).toBe(true),
      );
    });
  });

  describe("closing the business day", () => {
    it("shows a Закрыть день button only while the day is open", async () => {
      stubApi(snapshot([freeConsole(1)]));
      renderHall();

      await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
      expect(screen.getByRole("button", { name: "Закрыть день" })).toBeInTheDocument();
    });

    it("does not show a Закрыть день button while the day is closed", async () => {
      stubApi({ ...snapshot([freeConsole(1)]), business_day_open: false });
      renderHall();

      await waitFor(() => expect(screen.getByText("День не открыт. Открыть?")).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: "Закрыть день" })).not.toBeInTheDocument();
    });

    it("keeps the day history reachable while the day is closed", async () => {
      stubApi({ ...snapshot([freeConsole(1)]), business_day_open: false });
      renderHall();

      await waitFor(() => expect(screen.getByText("День не открыт. Открыть?")).toBeInTheDocument());
      expect(screen.getByRole("button", { name: "История дней" })).toBeInTheDocument();
    });

    it("opens the close-day dialog listing an active session, and finishing it reaches the reconciliation screen", async () => {
      let hall = snapshot([paidConsole(1, 7, 0)]);
      const fetchMock = vi.fn(async (url: string) => {
        if (url === "/api/hall") return { ok: true, json: async () => hall };
        if (url === "/api/settings") return { ok: true, json: async () => ({ grace_minutes: 3, warn_minutes: 5 }) };
        if (url === "/api/sessions/7/stop") {
          hall = snapshot([freeConsole(1)]);
          return { ok: true, json: async () => ({ id: 7, status: "finished", balance: 0 }) };
        }
        if (url.endsWith("/summary")) {
          return {
            ok: true,
            json: async () => ({
              opening_cash: 5000, cash_total: 0, qr_total: 0, transfer_total: 0, expected_cash: 5000,
              sessions_count: 1, minutes_total: 10, bar_sales_total: 0, has_active_sessions: false,
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      });
      vi.stubGlobal("fetch", fetchMock);
      renderHall();

      await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Закрыть день" }));

      await waitFor(() =>
        expect(screen.getByText("Нельзя закрыть день, пока есть незавершённые сессии.")).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Завершить" }));

      await waitFor(() => expect(screen.getByText("Наличные ожидается: 5 000 сом")).toBeInTheDocument());
    });

    it("opens the history dialog and shows a closed day", async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url === "/api/hall") return { ok: true, json: async () => snapshot([freeConsole(1)]) };
        if (url === "/api/settings") return { ok: true, json: async () => ({ grace_minutes: 3, warn_minutes: 5 }) };
        if (url === "/api/business-days?limit=30") {
          return {
            ok: true,
            json: async () => [
              { id: 2, opened_at: "2026-09-23T04:00:00Z", closed_at: "2026-09-23T20:00:00Z", opening_cash: 1000, expected_cash: 1200, counted_cash: 1200 },
            ],
          };
        }
        return { ok: true, json: async () => ({}) };
      });
      vi.stubGlobal("fetch", fetchMock);
      renderHall();

      await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "История дней" }));

      await waitFor(() => expect(screen.getByText(/Начало: 1 000 сом/)).toBeInTheDocument());
    });

    it("returns to the close-day dialog after settling a debt incurred while finishing a session from it", async () => {
      let hall = snapshot([paidConsole(1, 7, 150)]);
      const fetchMock = vi.fn(async (url: string) => {
        if (url === "/api/hall") return { ok: true, json: async () => hall };
        if (url === "/api/settings") return { ok: true, json: async () => ({ grace_minutes: 3, warn_minutes: 5 }) };
        if (url === "/api/sessions/7/stop") {
          hall = snapshot([freeConsole(1)]);
          return { ok: true, json: async () => ({ id: 7, status: "finished", balance: 150 }) };
        }
        if (url === "/api/sessions/7/payments") return { ok: true, json: async () => ({ id: 1 }) };
        if (url.endsWith("/summary")) {
          return {
            ok: true,
            json: async () => ({
              opening_cash: 5000, cash_total: 0, qr_total: 0, transfer_total: 0, expected_cash: 5000,
              sessions_count: 1, minutes_total: 10, bar_sales_total: 0, has_active_sessions: false,
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      });
      vi.stubGlobal("fetch", fetchMock);
      renderHall();

      await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Закрыть день" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Завершить" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Завершить" }));

      await waitFor(() => expect(screen.getByText("Оплата — остаток 150 сом")).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "150" } });
      fireEvent.click(screen.getByRole("button", { name: "Внести" }));

      await waitFor(() => expect(screen.getByText("Наличные ожидается: 5 000 сом")).toBeInTheDocument());
    });
  });
});
