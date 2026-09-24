import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionActions } from "@/features/hall/useSessionActions";

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useSessionActions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls the stop endpoint for the given session", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 5 }) });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessionActions(), { wrapper });
    await result.current.stop(5);

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/5/stop", expect.objectContaining({ method: "POST" }));
  });

  it("calls the cancel endpoint for the given session", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 5 }) });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessionActions(), { wrapper });
    await result.current.cancel(5);

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/5/cancel", expect.objectContaining({ method: "POST" }));
  });
});
