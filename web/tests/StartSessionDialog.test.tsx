import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StartSessionDialog } from "@/features/hall/StartSessionDialog";

vi.mock("@/lib/clock", () => ({ serverNow: () => new Date("2026-09-25T02:00:00+06:00").getTime() }));

function renderDialog(onStarted = vi.fn()) {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <StartSessionDialog open consoleId={1} consoleName="PS5-1" onOpenChange={() => {}} onStarted={onStarted} />
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

    await waitFor(() => expect(screen.getByRole("button", { name: /^1 час/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^1 час/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Начать на PS5-1/ }));

    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const startCall = calls.find(([url]) => url === "/api/sessions");
    expect(startCall).toBeTruthy();
    expect(JSON.parse(startCall![1].body as string)).toMatchObject({ console_id: 1, kind: "paid", tariff_id: 1 });
  });

  function stubWithGames(games: { id: number; name: string }[]) {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/tariffs") {
        return {
          ok: true,
          json: async () => [
            { id: 1, zone_id: 1, kind: "package", name: "1 час", duration_min: 60, price: 150, hourly_rate: null, is_active: true },
          ],
        };
      }
      if (url === "/api/games") return { ok: true, json: async () => games };
      return { ok: true, json: async () => ({ id: 1 }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function startedBody(fetchMock: ReturnType<typeof stubWithGames>) {
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const startCall = calls.find(([url, init]) => url === "/api/sessions" && init?.method === "POST");
    return JSON.parse(startCall![1].body as string);
  }

  it("lets the operator pick a game from the owner's list and sends its id", async () => {
    const fetchMock = stubWithGames([
      { id: 5, name: "FC26" },
      { id: 6, name: "UFC5" },
    ]);
    const { onStarted } = renderDialog();

    await waitFor(() => expect(screen.getByRole("button", { name: "FC26" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^1 час/ }));
    fireEvent.click(screen.getByRole("button", { name: "UFC5" }));
    expect(screen.getByRole("button", { name: "UFC5" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /^Начать на PS5-1/ }));

    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(startedBody(fetchMock)).toMatchObject({ game_id: 6 });
  });

  it("sends no game when none is picked, or when the pick is tapped again", async () => {
    const fetchMock = stubWithGames([{ id: 5, name: "FC26" }]);
    const { onStarted } = renderDialog();

    await waitFor(() => expect(screen.getByRole("button", { name: "FC26" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^1 час/ }));
    fireEvent.click(screen.getByRole("button", { name: "FC26" }));
    fireEvent.click(screen.getByRole("button", { name: "FC26" }));
    expect(screen.getByRole("button", { name: "FC26" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: /^Начать на PS5-1/ }));

    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(startedBody(fetchMock).game_id).toBeNull();
  });

  it("shows no game section while the owner's list is empty", async () => {
    stubWithGames([]);
    renderDialog();

    await waitFor(() => expect(screen.getByRole("button", { name: /^1 час/ })).toBeInTheDocument());
    expect(screen.queryByText(/Во что играют/)).toBeNull();
  });

  it("asks for no game on a service session", async () => {
    stubWithGames([{ id: 5, name: "FC26" }]);
    renderDialog();

    await waitFor(() => expect(screen.getByRole("button", { name: "FC26" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Служебная" }));

    expect(screen.queryByRole("button", { name: "FC26" })).toBeNull();
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

    await waitFor(() => expect(screen.getByRole("button", { name: /^1 час/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^1 час/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Начать на PS5-1/ }));

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

    await waitFor(() => expect(screen.getByRole("button", { name: /^5 часов/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^5 часов/ }));

    await waitFor(() =>
      expect(screen.getByText(/после планового закрытия \(05:00\)/)).toBeInTheDocument(),
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

    await waitFor(() => expect(screen.getByRole("button", { name: /^1 час/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^1 час/ }));

    await waitFor(() => expect(screen.getByRole("button", { name: /^Начать на PS5-1/ })).not.toBeDisabled());
    expect(screen.queryByText(/после планового закрытия/)).not.toBeInTheDocument();
  });

  it("prices the start button for a paid package", async () => {
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
    fireEvent.click(await screen.findByRole("button", { name: /^1 час/ }));
    expect(screen.getByRole("button", { name: "Начать на PS5-1 · 150 сом" })).toBeInTheDocument();
  });

  it("marks a tile that runs past the planned close with its end time", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/tariffs") {
        return {
          ok: true,
          json: async () => [
            { id: 1, zone_id: 1, kind: "package", name: "1 час", duration_min: 60, price: 150, hourly_rate: null, is_active: true },
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
    // Now is 02:00; the package starts after the 3-minute grace period.
    await waitFor(() => expect(screen.getByText("до 07:03 · после закрытия")).toBeInTheDocument());
    expect(screen.getByText("до 03:03")).toBeInTheDocument();
  });

  it("states the club's own grace default (1 minute) until the settings arrive", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/settings") return new Promise(() => {}); // still loading
        if (url === "/api/tariffs") return { ok: true, json: async () => [] };
        return { ok: true, json: async () => ({}) };
      }),
    );
    renderDialog();

    expect(await screen.findByText(/Первые 1 минута — на выбор игры/)).toBeInTheDocument();
  });
});
