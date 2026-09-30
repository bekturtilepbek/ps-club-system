import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusinessDayGuard } from "@/features/hall/BusinessDayGuard";

function routedFetch(openResult: { ok: boolean; status?: number; json: () => Promise<unknown> } = { ok: true, json: async () => ({ id: 1 }) }) {
  return vi.fn(async (url: string) => {
    if (url === "/api/business-days?limit=30") {
      return {
        ok: true,
        json: async () => [
          { id: 1, opened_at: "2026-09-29T04:04:00Z", closed_at: "2026-09-29T22:51:00Z", opening_cash: 2000, expected_cash: 6120, counted_cash: 6070 },
        ],
      };
    }
    if (url === "/api/settings") {
      return { ok: true, json: async () => ({ grace_minutes: 3, warn_minutes: 5, planned_open: "10:00", planned_close: "05:00" }) };
    }
    return openResult;
  });
}

describe("BusinessDayGuard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders children unchanged when a day is open", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BusinessDayGuard businessDayOpen>
          <div>Зал</div>
        </BusinessDayGuard>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Зал")).toBeInTheDocument();
  });

  it("prompts to open the day, and opens it on confirmation", async () => {
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BusinessDayGuard businessDayOpen={false}>
          <div>Зал</div>
        </BusinessDayGuard>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "Открыть день" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Наличные на начало"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /^Открыть день/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/business-days/open",
        expect.objectContaining({ body: JSON.stringify({ opening_cash: 5000 }) }),
      ),
    );
  });

  it("keeps the button disabled for a negative or non-numeric opening cash", () => {
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BusinessDayGuard businessDayOpen={false}>
          <div>Зал</div>
        </BusinessDayGuard>
      </QueryClientProvider>,
    );

    const input = screen.getByLabelText("Наличные на начало");
    const button = screen.getByRole("button", { name: /^Открыть день/ });

    fireEvent.change(input, { target: { value: "-100" } });
    expect(button).toBeDisabled();

    fireEvent.change(input, { target: { value: "abc" } });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/business-days/open", expect.anything());

    fireEvent.change(input, { target: { value: "0" } });
    expect(button).not.toBeDisabled();
  });

  it("shows an error message when opening the day fails", async () => {
    const fetchMock = routedFetch({
      ok: false,
      status: 409,
      json: async () => ({ detail: "business day already open" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BusinessDayGuard businessDayOpen={false}>
          <div>Зал</div>
        </BusinessDayGuard>
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("Наличные на начало"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /^Открыть день/ }));

    await waitFor(() =>
      expect(screen.getByText("Не удалось открыть день. Попробуйте ещё раз.")).toBeInTheDocument(),
    );
  });

  it("remembers yesterday's opening cash as a one-tap suggestion", async () => {
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BusinessDayGuard businessDayOpen={false}>
          <div>Зал</div>
        </BusinessDayGuard>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/прошлый закрыт 30\.09 в 04:51/)).toBeInTheDocument();
    // Accessible names keep the non-breaking thousands space, so match it with \s.
    fireEvent.click(screen.getByRole("button", { name: /^Как вчера на начало: 2\s000$/ }));
    expect(screen.getByLabelText("Наличные на начало")).toHaveValue(2000);
    expect(screen.getByRole("button", { name: /^Открыть день · 2\s000 сом$/ })).toBeEnabled();
  });
});
