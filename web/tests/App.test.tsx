import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";

function renderApp() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the login form when not authenticated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ authenticated: false }) }),
    );
    renderApp();
    await waitFor(() => expect(screen.getByLabelText("Пароль")).toBeInTheDocument());
  });

  it("shows the hall grid when authenticated", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/auth/me") return { ok: true, json: async () => ({ authenticated: true }) };
      if (url === "/api/hall") {
        return {
          ok: true,
          json: async () => ({
            generated_at: new Date().toISOString(),
            business_day_open: true,
            consoles: [
              { id: 1, zone_id: 1, name: "PS5-1", is_active: true, session: null, charge_total: 0, paid_total: 0, balance: 0 },
            ],
          }),
        };
      }
      if (url === "/api/settings") return { ok: true, json: async () => ({ grace_minutes: 3, warn_minutes: 5 }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "WebSocket",
      class {
        onopen: (() => void) | null = null;
        onmessage: (() => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;
        close() {}
      } as unknown as typeof WebSocket,
    );

    renderApp();
    await waitFor(() => expect(screen.getByTestId("hall-page")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
  });
});
