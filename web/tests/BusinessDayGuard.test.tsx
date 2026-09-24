import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusinessDayGuard } from "@/features/hall/BusinessDayGuard";

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
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BusinessDayGuard businessDayOpen={false}>
          <div>Зал</div>
        </BusinessDayGuard>
      </QueryClientProvider>,
    );

    expect(screen.getByText("День не открыт. Открыть?")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Наличные на начало"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/business-days/open",
        expect.objectContaining({ body: JSON.stringify({ opening_cash: 5000 }) }),
      ),
    );
  });
});
