import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StartSessionDialog } from "@/features/hall/StartSessionDialog";
import { useNow } from "@/features/hall/useNow";

let clockMs = new Date("2026-09-25T02:00:00+06:00").getTime();
vi.mock("@/lib/clock", () => ({ serverNow: () => clockMs }));

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clockMs = new Date("2026-09-25T02:00:00+06:00").getTime();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("ticks while active and stops when inactive", () => {
    const { result, rerender } = renderHook(({ active }) => useNow(active, 15_000), { initialProps: { active: true } });
    const first = result.current;
    clockMs += 60_000;
    act(() => vi.advanceTimersByTime(15_000));
    expect(result.current).toBe(first + 60_000);
    rerender({ active: false });
    clockMs += 60_000;
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toBe(first + 60_000);
  });

  it("advances the start dialog's end-time label while it stays open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url === "/api/tariffs"
            ? [{ id: 1, zone_id: 1, kind: "package", name: "1 час", duration_min: 60, price: 150, hourly_rate: null, is_active: true }]
            : { grace_minutes: 3, warn_minutes: 5, planned_open: "10:00", planned_close: "05:00" },
      })),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <StartSessionDialog open consoleId={1} consoleName="PS5-1" onOpenChange={() => {}} onStarted={() => {}} />
      </QueryClientProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("до 03:03")).toBeInTheDocument();
    clockMs += 10 * 60_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getByText("до 03:13")).toBeInTheDocument();
  });
});
