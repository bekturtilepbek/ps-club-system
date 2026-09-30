import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentDialog } from "@/features/hall/PaymentDialog";

describe("PaymentDialog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("submits a cash payment for the entered amount", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    const onPaid = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <PaymentDialog open sessionId={5} balance={300} onOpenChange={() => {}} onPaid={onPaid} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Наличные" }));
    fireEvent.click(screen.getByRole("button", { name: /^Внести/ }));

    await waitFor(() => expect(onPaid).toHaveBeenCalledWith(100));
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const payCall = calls.find(([url]) => url === "/api/sessions/5/payments");
    expect(JSON.parse(payCall![1].body as string)).toEqual({ amount: 100, method: "cash" });
  });

  it("does not close itself after a successful payment", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    const onPaid = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <PaymentDialog open sessionId={5} balance={300} onOpenChange={onOpenChange} onPaid={onPaid} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Наличные" }));
    fireEvent.click(screen.getByRole("button", { name: /^Внести/ }));

    await waitFor(() => expect(onPaid).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("shows an error message when the payment request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ detail: "Invalid amount" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    const onPaid = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <PaymentDialog open sessionId={5} balance={300} onOpenChange={() => {}} onPaid={onPaid} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Наличные" }));
    fireEvent.click(screen.getByRole("button", { name: /^Внести/ }));

    await waitFor(() => expect(screen.getByText("Не удалось провести оплату. Попробуйте ещё раз.")).toBeInTheDocument());
    expect(onPaid).not.toHaveBeenCalled();
  });
});
