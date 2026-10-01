import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloseBusinessDayDialog } from "@/features/hall/CloseBusinessDayDialog";
import type { HallConsoleResponse, HallSnapshotResponse } from "@/lib/api";

function freeConsole(id: number): HallConsoleResponse {
  return { id, zone_id: 1, name: `PS5-${id}`, is_active: true, session: null, charge_total: 0, paid_total: 0, balance: 0 };
}

function activeConsole(id: number, sessionId: number, balance: number): HallConsoleResponse {
  const now = new Date().toISOString();
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
      started_at: now,
      grace_until: now,
      ended_at: null,
      comment: null,
      segments: [],
      orders: [],
      charge_total: balance,
      paid_total: 0,
      balance,
    },
    charge_total: balance,
    paid_total: 0,
    balance,
  };
}

function emptySnapshot(): HallSnapshotResponse {
  return { generated_at: new Date().toISOString(), business_day_open: true, business_day_id: 1, consoles: [], tickets: [] };
}

const SUMMARY = {
  opening_cash: 5000,
  cash_total: 300,
  
  transfer_total: 100,
  expected_cash: 5300,
  sessions_count: 2,
  minutes_total: 90,
  bar_sales_total: 160,
  has_active_sessions: false,
};

function stubSummaryFetch() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/business-days/1/summary") return { ok: true, json: async () => SUMMARY };
    if (url === "/api/business-days/1/close") {
      const body = JSON.parse((init?.body as string) ?? "{}");
      return { ok: true, json: async () => ({ id: 1, opened_at: "2026-09-24T04:00:00Z", closed_at: "2026-09-24T20:00:00Z", opening_cash: 5000, expected_cash: 5300, counted_cash: body.counted_cash }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderDialog(hall: HallSnapshotResponse, onFinishSession = vi.fn(), onClosed = vi.fn()) {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <CloseBusinessDayDialog
        open
        businessDayId={1}
        hall={hall}
        error={null}
        pending={false}
        onOpenChange={() => {}}
        onFinishSession={onFinishSession}
        onClosed={onClosed}
      />
    </QueryClientProvider>,
  );
  return { onFinishSession, onClosed };
}

describe("CloseBusinessDayDialog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists active console sessions and tickets with a Завершить button", () => {
    stubSummaryFetch();
    const hall: HallSnapshotResponse = {
      generated_at: new Date().toISOString(),
      business_day_open: true,
      business_day_id: 1,
      consoles: [freeConsole(1), activeConsole(2, 10, 150)],
      tickets: [
        {
          id: 20, console_id: null, business_day_id: 1, kind: "paid", reason: null, status: "active",
          started_at: new Date().toISOString(), grace_until: null, ended_at: null, comment: null,
          segments: [], orders: [], charge_total: 80, paid_total: 0, balance: 80,
        },
      ],
    };
    const { onFinishSession } = renderDialog(hall);

    expect(screen.getByText("Нельзя закрыть день, пока есть незавершённые сессии.")).toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: "PS5-2" })).getByText("150 сом")).toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: "Чек №20" })).getByText("80 сом")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Завершить" })[0]);
    expect(onFinishSession).toHaveBeenCalledWith(10);
  });

  it("shows the reconciliation once there are no active sessions", async () => {
    stubSummaryFetch();
    renderDialog(emptySnapshot());

    await waitFor(() => expect(screen.getByText("Должно быть в кассе")).toBeInTheDocument());
    expect(screen.getByTestId("expected-cash")).toHaveTextContent("5 300 сом");
    expect(screen.getByText("Перевод").closest("label")).toHaveTextContent("100 сом");
    expect(screen.getByText("Сессий: 2")).toBeInTheDocument();
    expect(screen.getByText("Часы игры: 1 ч 30 мин")).toBeInTheDocument();
    expect(screen.getByText("Бар: 160 сом")).toBeInTheDocument();
  });

  it("highlights a discrepancy between expected and counted cash", async () => {
    stubSummaryFetch();
    renderDialog(emptySnapshot());

    await waitFor(() => expect(screen.getByLabelText("Посчитано наличных")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Посчитано наличных"), { target: { value: "5200" } });

    await waitFor(() => expect(screen.getByTestId("discrepancy")).toHaveTextContent("−100 сом"));
  });

  it("closes the day with the entered counted cash and calls onClosed", async () => {
    const fetchMock = stubSummaryFetch();
    const { onClosed } = renderDialog(emptySnapshot());

    await waitFor(() => expect(screen.getByLabelText("Посчитано наличных")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Посчитано наличных"), { target: { value: "5300" } });
    fireEvent.click(screen.getByRole("button", { name: "Закрыть день и отправить сводку" }));

    await waitFor(() => expect(onClosed).toHaveBeenCalled());
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const closeCall = calls.find(([url]) => url === "/api/business-days/1/close");
    expect(JSON.parse(closeCall![1].body as string)).toEqual({ counted_cash: 5300 });
  });

  it("shows an error message and disables Завершить buttons while a finish is pending", () => {
    stubSummaryFetch();
    const hall: HallSnapshotResponse = {
      generated_at: new Date().toISOString(),
      business_day_open: true,
      business_day_id: 1,
      consoles: [activeConsole(2, 10, 150)],
      tickets: [],
    };
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <CloseBusinessDayDialog
          open
          businessDayId={1}
          hall={hall}
          error="Не удалось выполнить действие. Попробуйте ещё раз."
          pending
          onOpenChange={() => {}}
          onFinishSession={() => {}}
          onClosed={() => {}}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Не удалось выполнить действие. Попробуйте ещё раз.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Завершить" })).toBeDisabled();
  });
});
