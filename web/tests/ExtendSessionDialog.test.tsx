import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtendSessionDialog } from "@/features/hall/ExtendSessionDialog";

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
});
