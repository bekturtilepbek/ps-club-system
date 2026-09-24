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

  it("shows the hall placeholder when authenticated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ authenticated: true }) }),
    );
    renderApp();
    await waitFor(() => expect(screen.getByTestId("hall-page")).toBeInTheDocument());
  });
});
