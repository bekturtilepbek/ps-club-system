import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "@/App";

class SilentWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

const HALL = {
  generated_at: new Date().toISOString(),
  business_day_open: true,
  business_day_id: 1,
  consoles: [{ id: 1, zone_id: 1, name: "PS5-1", is_active: true, session: null, charge_total: 0, paid_total: 0, balance: 0 }],
  tickets: [],
};

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, statusText: "x", json: async () => body };
}

function renderApp(hallAvailable: { current: boolean }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/auth/me") return json({ authenticated: true });
      if (url === "/api/hall") {
        if (!hallAvailable.current) throw new TypeError("Failed to fetch");
        return json(HALL);
      }
      if (url === "/api/tickets") return json({ detail: "boom" }, 500);
      if (url === "/api/settings") return json({ grace_minutes: 1, warn_minutes: 5, planned_open: "10:00", planned_close: "05:00" });
      if (url === "/api/business-days/current") return json({ id: 1, opened_at: new Date().toISOString() });
      return json({});
    }),
  );
  vi.stubGlobal("WebSocket", SilentWebSocket as unknown as typeof WebSocket);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("losing the connection to the server", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tells the operator the screen may be out of date instead of looking alive", async () => {
    renderApp({ current: false });

    expect(await screen.findByText(/Нет связи с сервером/)).toBeInTheDocument();
  });

  it("shows no warning while the server answers", async () => {
    renderApp({ current: true });

    await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
    expect(screen.queryByText(/Нет связи с сервером/)).toBeNull();
  });

  it("clears the warning and the last failed-action message once the connection is back", async () => {
    const hallAvailable = { current: true };
    const queryClient = renderApp(hallAvailable);
    await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "+ Продажа без игры" }));
    await screen.findByText("Не удалось выполнить действие. Попробуйте ещё раз.");
    hallAvailable.current = false;
    await queryClient.invalidateQueries({ queryKey: ["hall"] });
    await screen.findByText(/Нет связи с сервером/);

    hallAvailable.current = true;
    await queryClient.invalidateQueries({ queryKey: ["hall"] });

    await waitFor(() => expect(screen.queryByText(/Нет связи с сервером/)).toBeNull());
    expect(screen.queryByText("Не удалось выполнить действие. Попробуйте ещё раз.")).toBeNull();
  });
});
