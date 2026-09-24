import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StartSessionDialog } from "@/features/hall/StartSessionDialog";

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
});
