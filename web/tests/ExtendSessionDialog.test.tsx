import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtendSessionDialog } from "@/features/hall/ExtendSessionDialog";

vi.mock("@/lib/clock", () => ({ serverNow: () => new Date("2026-09-25T02:00:00+06:00").getTime() }));

describe("ExtendSessionDialog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("extends the session with the selected tariff", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/tariffs") {
        return {
          ok: true,
          json: async () => [
            { id: 2, zone_id: 1, kind: "open", name: "Открытое время", duration_min: null, price: null, hourly_rate: 120, is_active: true },
          ],
        };
      }
      return { ok: true, json: async () => ({ id: 5 }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    const onExtended = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <ExtendSessionDialog open sessionId={5} onOpenChange={() => {}} onExtended={onExtended} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText(/Открытое время/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Открытое время/));
    fireEvent.click(screen.getByRole("button", { name: "Продлить" }));

    await waitFor(() => expect(onExtended).toHaveBeenCalled());
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const extendCall = calls.find(([url]) => url === "/api/sessions/5/extend");
    expect(JSON.parse(extendCall![1].body as string)).toEqual({ tariff_id: 2 });
  });

  it("shows an error message when extending fails", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/tariffs") {
        return {
          ok: true,
          json: async () => [
            { id: 2, zone_id: 1, kind: "open", name: "Открытое время", duration_min: null, price: null, hourly_rate: 120, is_active: true },
          ],
        };
      }
      return { ok: false, status: 409, json: async () => ({ detail: "session is not active" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    const onExtended = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <ExtendSessionDialog open sessionId={5} onOpenChange={() => {}} onExtended={onExtended} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText(/Открытое время/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Открытое время/));
    fireEvent.click(screen.getByRole("button", { name: "Продлить" }));

    await waitFor(() => expect(screen.getByText("Не удалось продлить сессию. Попробуйте ещё раз.")).toBeInTheDocument());
    expect(onExtended).not.toHaveBeenCalled();
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
      return { ok: true, json: async () => ({ id: 5 }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ExtendSessionDialog open sessionId={5} onOpenChange={() => {}} onExtended={() => {}} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText("5 часов — 700 сом")).toBeInTheDocument());
    fireEvent.click(screen.getByText("5 часов — 700 сом"));

    await waitFor(() =>
      expect(screen.getByText(/Пакет закончится после планового закрытия \(05:00\)/)).toBeInTheDocument(),
    );
  });
});
