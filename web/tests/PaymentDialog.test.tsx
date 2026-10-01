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

  describe("closing with money still owed", () => {
    function renderOwing(props: { confirmCloseWithBalance?: boolean; balance?: number } = {}) {
      const onOpenChange = vi.fn();
      render(
        <QueryClientProvider client={new QueryClient()}>
          <PaymentDialog
            open
            sessionId={5}
            balance={props.balance ?? 300}
            confirmCloseWithBalance={props.confirmCloseWithBalance}
            onOpenChange={onOpenChange}
            onPaid={() => {}}
          />
        </QueryClientProvider>,
      );
      return onOpenChange;
    }

    it("asks before closing, and keeps the payment open when the operator goes back", async () => {
      const onOpenChange = renderOwing({ confirmCloseWithBalance: true });

      fireEvent.keyDown(screen.getByRole("dialog", { name: /Оплата/ }), { key: "Escape" });
      expect(await screen.findByText("Гость ещё должен 300 сом")).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Вернуться к оплате" }));
      await waitFor(() => expect(screen.queryByText("Гость ещё должен 300 сом")).toBeNull());
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.getByText(/Оплата · остаток/)).toBeInTheDocument();
    });

    it("closes only after the operator confirms leaving the debt", async () => {
      const onOpenChange = renderOwing({ confirmCloseWithBalance: true });

      fireEvent.keyDown(screen.getByRole("dialog", { name: /Оплата/ }), { key: "Escape" });
      fireEvent.click(await screen.findByRole("button", { name: "Закрыть без оплаты" }));

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("closes straight away when confirmation is not requested", () => {
      const onOpenChange = renderOwing();

      fireEvent.keyDown(screen.getByRole("dialog", { name: /Оплата/ }), { key: "Escape" });

      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(screen.queryByText(/Гость ещё должен/)).toBeNull();
    });
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
