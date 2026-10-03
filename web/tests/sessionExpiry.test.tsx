import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "@/App";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
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

let signedIn = true;

function renderSignedInApp(overrides: Record<string, () => ReturnType<typeof json>> = {}) {
  signedIn = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (overrides[url]) return overrides[url]();
      if (url === "/api/auth/me") return json({ authenticated: signedIn });
      if (url === "/api/hall") return json(HALL);
      if (url === "/api/settings") return json({ grace_minutes: 1, warn_minutes: 5, planned_open: "10:00", planned_close: "05:00" });
      if (url === "/api/business-days/current") return json({ id: 1, opened_at: new Date().toISOString() });
      return json({});
    }),
  );
  vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <App />
    </QueryClientProvider>,
  );
  return { signOut: () => (signedIn = false) };
}

describe("a session that expires while the hall is open", () => {
  afterEach(() => {
    FakeWebSocket.instances = [];
    vi.unstubAllGlobals();
  });

  it("returns to the login form when an action is answered with 401", async () => {
    const { signOut } = renderSignedInApp({ "/api/tickets": () => json({ detail: "authentication required" }, 401) });
    await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
    signOut();

    fireEvent.click(screen.getByRole("button", { name: "+ Продажа без игры" }));

    await waitFor(() => expect(screen.getByLabelText("Пароль")).toBeInTheDocument());
  });

  it("returns to the login form when the periodic hall refresh is answered with 401", async () => {
    // The socket only checks the login when it connects; the 5 s / 60 s refresh is what notices a
    // login that stopped being valid afterwards (a browser reports a refused socket as a plain 1006).
    renderSignedInApp({
      "/api/hall": () => {
        signedIn = false; // the server no longer knows this login: /api/auth/me agrees from now on
        return json({ detail: "authentication required" }, 401);
      },
    });

    await waitFor(() => expect(screen.getByLabelText("Пароль")).toBeInTheDocument());
  });

  it("does not treat a wrong password as an expired session", async () => {
    renderSignedInApp();
    await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
    // (the login form only exists for signed-out users; this guards the exclusion in api.ts)
    const { api } = await import("@/lib/api");
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "invalid password" }, 401)));

    await expect(api.login("nope")).rejects.toMatchObject({ status: 401 });

    expect(screen.getByText("PS5-1")).toBeInTheDocument();
  });
});
