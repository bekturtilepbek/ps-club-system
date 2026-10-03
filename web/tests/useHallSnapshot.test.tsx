import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHallSnapshot } from "@/features/hall/useHallSnapshot";
import { serverNow } from "@/lib/clock";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
    this.onclose?.();
  }

  emitOpen() {
    this.onopen?.();
  }

  emitMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useHallSnapshot", () => {
  afterEach(() => {
    FakeWebSocket.instances = [];
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("applies a snapshot pushed over the websocket", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ generated_at: new Date().toISOString(), business_day_open: false, consoles: [] }),
      }),
    );
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);

    const { result } = renderHook(() => useHallSnapshot(), { wrapper });

    const socket = FakeWebSocket.instances[0];
    act(() => {
      socket.emitOpen();
      socket.emitMessage({
        generated_at: new Date().toISOString(),
        business_day_open: true,
        consoles: [{ id: 1, zone_id: 1, name: "PS5-1", is_active: true, session: null, charge_total: 0, paid_total: 0, balance: 0 }],
      });
    });

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.data?.consoles).toHaveLength(1));
  });

  it("falls back to polling while disconnected and stops once the socket opens", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ generated_at: new Date().toISOString(), business_day_open: false, consoles: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);

    const { result } = renderHook(() => useHallSnapshot(), { wrapper });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.connected).toBe(false);

    const socket = FakeWebSocket.instances[0];
    act(() => socket.emitOpen());
    await waitFor(() => expect(result.current.connected).toBe(true));
  });

  it("polls every 5 s while disconnected and only every 20 s as a safety net once connected", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ generated_at: new Date().toISOString(), business_day_open: false, consoles: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);

    renderHook(() => useHallSnapshot(), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Disconnected: fast poll.
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Connected: no fast poll any more...
    act(() => FakeWebSocket.instances[0].emitOpen());
    await act(() => vi.advanceTimersByTimeAsync(19_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // ...but a slow safety refetch still happens, in case pushes silently stopped.
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reconnects with a growing backoff and resets it after a successful open", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ generated_at: new Date().toISOString(), business_day_open: false, consoles: [] }),
      }),
    );
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);

    renderHook(() => useHallSnapshot(), { wrapper });

    expect(FakeWebSocket.instances).toHaveLength(1);

    // First failure: reconnect should not happen immediately.
    act(() => FakeWebSocket.instances[0].close());
    expect(FakeWebSocket.instances).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(FakeWebSocket.instances).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(FakeWebSocket.instances).toHaveLength(2);

    // Second failure: backoff should have grown beyond the first delay.
    act(() => FakeWebSocket.instances[1].close());
    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(FakeWebSocket.instances).toHaveLength(2);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(FakeWebSocket.instances).toHaveLength(3);

    // A successful open resets the backoff back to the initial delay.
    act(() => {
      FakeWebSocket.instances[2].emitOpen();
      FakeWebSocket.instances[2].close();
    });
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(FakeWebSocket.instances).toHaveLength(3);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it("takes the clock offset from a polled snapshot too, not only from the websocket", async () => {
    // With the socket down (or between pushes) the poll is the only source of server time.
    const serverMs = Date.now() + 60_000;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          generated_at: new Date(serverMs).toISOString(),
          business_day_open: false,
          business_day_id: null,
          consoles: [],
          tickets: [],
        }),
      }),
    );
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);

    const { result } = renderHook(() => useHallSnapshot(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(Math.abs(serverNow() - serverMs)).toBeLessThan(2000);
  });
});
