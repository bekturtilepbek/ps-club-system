import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ReactElement, cloneElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalyticsPage } from "@/features/analytics/AnalyticsPage";
import { rangeForPreset } from "@/features/analytics/periods";

// jsdom has no ResizeObserver or layout, so ResponsiveContainer cannot measure; give it a fixed size.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 800, height: 280 }),
  };
});

const totals = (revenue: number, empty = false) => ({
  cash_total: revenue, transfer_total: 0, revenue_total: revenue, paid_sessions_count: empty ? 0 : 4,
  avg_check: empty ? null : 250, bar_per_session: empty ? null : 90, free_minutes: empty ? 0 : 120,
  service_minutes: 0, bar_sales_total: empty ? 0 : 360,
});

function cells(busyAt?: { weekday: number; hour: number }) {
  return Array.from({ length: 168 }, (_, i) => {
    const weekday = Math.floor(i / 24);
    const hour = i % 24;
    const hit = busyAt && busyAt.weekday === weekday && busyAt.hour === hour;
    return { weekday, hour, busy_minutes: hit ? 60 : 0, load_percent: hit ? 100 : 0 };
  });
}

function stubApi(empty = false, failPath?: string) {
  const requested: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    requested.push(url);
    const path = url.split("?")[0];
    if (path === failPath) return { ok: false, status: 500, statusText: "boom", json: async () => ({ detail: "boom" }) };
    const range = { date_from: "2026-09-01", date_to: "2026-09-30" };
    const body: Record<string, unknown> = {
      "/api/analytics/summary": {
        ...range, includes_open_day: false, current: totals(empty ? 0 : 1000, empty), previous: totals(800),
        changes: { revenue_total: empty ? null : 25, paid_sessions_count: null, avg_check: null, bar_per_session: null, free_minutes: empty ? null : -5, bar_sales_total: empty ? null : 10 },
      },
      "/api/analytics/revenue": { ...range, points: empty ? [] : [{ period_start: "2026-09-14", cash_total: 700, transfer_total: 300 }] },
      "/api/analytics/load": {
        ...range, consoles_count: 4, cells: cells(empty ? undefined : { weekday: 0, hour: 18 }),
        hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, load_percent: 0 })),
        quietest: empty ? null : { weekday: 2, hour: 11, busy_minutes: 0, load_percent: 0 },
        busiest: empty ? null : { weekday: 0, hour: 18, busy_minutes: 60, load_percent: 100 },
      },
      "/api/analytics/bar": { ...range, rows: empty ? [] : [{ name: "Кола", qty: 5, revenue: 500 }] },
      "/api/analytics/games": { ...range, rows: empty ? [] : [{ name: "FC 26", sessions: 3, revenue: 450 }, { name: null, sessions: 1, revenue: 90 }] },
    };
    return { ok: true, status: 200, json: async () => body[path] };
  });
  vi.stubGlobal("fetch", fetchMock);
  return requested;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnalyticsPage onBack={() => {}} />
    </QueryClientProvider>,
  );
}

describe("AnalyticsPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the totals, the quietest and busiest time and the rankings", async () => {
    stubApi();
    renderPage();
    expect(await screen.findByText(/самое загруженное/i)).toHaveTextContent("пн, 18:00–19:00");
    expect(screen.getByText(/самое пустое/i)).toHaveTextContent("ср, 11:00–12:00");
    expect(screen.getByText("Кола")).toBeInTheDocument();
    expect(screen.getByText("FC 26")).toBeInTheDocument();
    expect(screen.getByText("Не указана")).toBeInTheDocument();
    expect(screen.getByText("+25%")).toBeInTheDocument();
  });

  it("shows a change chip on the bar card and keeps the free-hours chip neutral", async () => {
    stubApi();
    renderPage();
    const barChip = await screen.findByText("+10%");
    expect(barChip.parentElement).toHaveClass("text-status-triangle");
    const freeChip = screen.getByText("−5%").parentElement;
    expect(freeChip).toHaveClass("text-fg-muted");
    expect(freeChip).not.toHaveClass("text-status-circle");
    expect(freeChip).toHaveTextContent("▼");
  });

  it("calls the game money column an accrual and the bar one revenue", async () => {
    stubApi();
    renderPage();
    await screen.findByText("FC 26");
    expect(screen.getByRole("columnheader", { name: "Начислено" })).toBeInTheDocument();
    const barTable = screen.getByText("Кола").closest("table") as HTMLElement;
    expect(within(barTable).getByRole("columnheader", { name: "Выручка" })).toBeInTheDocument();
  });

  it("keeps the heatmap grid intact: 25 cells per row and no display:none cells", async () => {
    stubApi();
    const { container } = renderPage();
    await screen.findByText(/самое загруженное/i);
    const grid = container.querySelector<HTMLElement>('[style*="grid-template-columns"]')!;
    expect(grid.children).toHaveLength(25 + 7); // corner + 24 hour labels, then 7 weekday rows
    for (const row of Array.from(grid.children).slice(25)) expect(row.children).toHaveLength(25); // label + 24 cells
    expect(container.querySelector(".max-md\\:hidden")).toBeNull();
  });

  it("renders a comparison chip only for metrics that have one", async () => {
    stubApi();
    renderPage();
    await screen.findByText("+25%");
    expect(screen.getAllByText(/к прошлому периоду/)).toHaveLength(3); // revenue, free hours, bar
  });

  it("asks for a different range when a preset is chosen", async () => {
    const requested = stubApi();
    renderPage();
    await screen.findByText(/самое загруженное/i);
    requested.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Всё время" }));
    await waitFor(() => expect(requested.some((url) => url.includes("from=2000-01-01"))).toBe(true));
  });

  it("asks for the chosen granularity", async () => {
    const requested = stubApi();
    renderPage();
    await screen.findByText(/самое загруженное/i);
    fireEvent.click(screen.getByRole("button", { name: "По неделям" }));
    await waitFor(() => expect(requested.some((url) => url.includes("group=week"))).toBe(true));
  });

  it("keeps the preset's other bound when only one date is edited", async () => {
    const requested = stubApi();
    renderPage();
    await screen.findByText(/самое загруженное/i);
    fireEvent.click(screen.getByRole("button", { name: "Прошлый месяц" }));
    const presetTo = rangeForPreset("prevMonth", Date.now()).to;
    await waitFor(() => expect(requested.some((url) => url.includes(`to=${presetTo}`))).toBe(true));
    requested.length = 0;
    fireEvent.change(screen.getByLabelText("С даты"), { target: { value: "2026-01-05" } });
    await waitFor(() =>
      expect(requested.some((url) => url.includes("from=2026-01-05") && url.includes(`to=${presetTo}`))).toBe(true),
    );
  });

  it("does not request a range whose start is after its end", async () => {
    const requested = stubApi();
    renderPage();
    await screen.findByText(/самое загруженное/i);
    requested.length = 0;
    fireEvent.change(screen.getByLabelText("С даты"), { target: { value: "2999-12-31" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Дата «с» позже даты «по»");
    expect(requested.some((url) => url.includes("from=2999-12-31"))).toBe(false);
    expect(screen.getByText(/самое загруженное/i)).toBeInTheDocument();
  });

  it("offers the hourly numbers in a collapsed table", async () => {
    stubApi();
    renderPage();
    expect(await screen.findByText("Цифры по часам")).toBeInTheDocument();
  });

  it("shows a section error instead of the empty text when the bar request fails", async () => {
    stubApi(false, "/api/analytics/bar");
    renderPage();
    expect(await screen.findByText("Не удалось загрузить бар")).toBeInTheDocument();
    expect(screen.queryByText("Продаж бара за период нет")).not.toBeInTheDocument();
    expect(screen.getByText("FC 26")).toBeInTheDocument();
  });

  it("says so instead of drawing empty charts when the period has no data", async () => {
    stubApi(true);
    renderPage();
    expect(await screen.findByText("Нет данных за период")).toBeInTheDocument();
    expect(screen.queryByText(/самое загруженное/i)).not.toBeInTheDocument();
  });
});
