import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StartSessionDialog } from "@/features/hall/StartSessionDialog";

vi.mock("@/lib/clock", () => ({ serverNow: () => new Date("2026-09-25T02:00:00+06:00").getTime() }));

function renderDialog(onStarted = vi.fn()) {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <StartSessionDialog open consoleId={1} onOpenChange={() => {}} onStarted={onStarted} />
    </QueryClientProvider>,
  );
  return { onStarted };
}

describe("StartSessionDialog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts a paid session with the selected tariff", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/tariffs") {
        return {
          ok: true,
          json: async () => [
            { id: 1, zone_id: 1, kind: "package", name: "1 час", duration_min: 60, price: 150, hourly_rate: null, is_active: true },
          ],
        };
      }
      return { ok: true, json: async () => ({ id: 1 }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const { onStarted } = renderDialog();

    await waitFor(() => expect(screen.getByText("1 час — 150 сом")).toBeInTheDocument());
    fireEvent.click(screen.getByText("1 час — 150 сом"));
    fireEvent.click(screen.getByRole("button", { name: "Начать" }));

    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const startCall = calls.find(([url]) => url === "/api/sessions");
    expect(startCall).toBeTruthy();
    expect(JSON.parse(startCall![1].body as string)).toMatchObject({ console_id: 1, kind: "paid", tariff_id: 1 });
  });

  it("shows an error message when starting the session fails", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/tariffs") {
        return {
          ok: true,
          json: async () => [
            { id: 1, zone_id: 1, kind: "package", name: "1 час", duration_min: 60, price: 150, hourly_rate: null, is_active: true },
          ],
        };
      }
      return { ok: false, status: 409, json: async () => ({ detail: "no open business day" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const { onStarted } = renderDialog();

    await waitFor(() => expect(screen.getByText("1 час — 150 сом")).toBeInTheDocument());
    fireEvent.click(screen.getByText("1 час — 150 сом"));
    fireEvent.click(screen.getByRole("button", { name: "Начать" }));

    await waitFor(() => expect(screen.getByText("Не удалось начать сессию. Попробуйте ещё раз.")).toBeInTheDocument());
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("shows a warning when the selected package would end after the planned close", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/tariffs") {
        return {
          ok: true,
          json: async () => [
            { id: 3, zone_id: 1, kind: "package", name: "5 часов", duration_min: 300, price: 700, hourly_rate: null, is_active: true },
          ],
        };
      }
      if (url === "/api/settings") {
        return { ok: true, json: async () => ({ grace_minutes: 3, warn_minutes: 5, planned_open: "10:00", planned_close: "05:00" }) };
      }
      return { ok: true, json: async () => ({ id: 1 }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    renderDialog();

    await waitFor(() => expect(screen.getByText("5 часов — 700 сом")).toBeInTheDocument());
    fireEvent.click(screen.getByText("5 часов — 700 сом"));

    await waitFor(() =>
      expect(screen.getByText(/Пакет закончится после планового закрытия \(05:00\)/)).toBeInTheDocument(),
    );
  });

  it("does not warn for a short package that ends before the planned close", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/tariffs") {
        return {
          ok: true,
          json: async () => [
            { id: 1, zone_id: 1, kind: "package", name: "1 час", duration_min: 60, price: 150, hourly_rate: null, is_active: true },
          ],
        };
      }
      if (url === "/api/settings") {
        return { ok: true, json: async () => ({ grace_minutes: 3, warn_minutes: 5, planned_open: "10:00", planned_close: "05:00" }) };
      }
      return { ok: true, json: async () => ({ id: 1 }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    renderDialog();

    await waitFor(() => expect(screen.getByText("1 час — 150 сом")).toBeInTheDocument());
    fireEvent.click(screen.getByText("1 час — 150 сом"));

    await waitFor(() => expect(screen.getByRole("button", { name: "Начать" })).not.toBeDisabled());
    expect(screen.queryByText(/Пакет закончится после планового закрытия/)).not.toBeInTheDocument();
  });
});
