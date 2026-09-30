import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentDialog } from "@/features/hall/PaymentDialog";

describe("PaymentDialog amounts and chips", () => {
  afterEach(() => vi.unstubAllGlobals());
  const setup = (balance: number, targetName?: string) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });
    vi.stubGlobal("fetch", fetchMock);
    const onPaid = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PaymentDialog open sessionId={5} balance={balance} targetName={targetName} onOpenChange={() => {}} onPaid={onPaid} />
      </QueryClientProvider>,
    );
    return { fetchMock, onPaid };
  };

  it("sends exactly the rounded whole-som amount shown on the button", async () => {
    const { fetchMock, onPaid } = setup(300);
    fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "99.6" } });
    const button = screen.getByRole("button", { name: /^Внести/ });
    expect(button.textContent).toMatch(/^Внести 100\s+сом$/);
    fireEvent.click(button);
    await waitFor(() => expect(onPaid).toHaveBeenCalledWith(100));
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(calls.find(([u]) => u === "/api/sessions/5/payments")![1].body as string).amount).toBe(100);
  });

  it("disables the button when the amount rounds to zero", () => {
    setup(300);
    fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "0.3" } });
    expect(screen.getByRole("button", { name: /^Внести/ })).toBeDisabled();
  });

  it("shows the target name chip", () => {
    setup(300, "Чек №214");
    expect(screen.getByText("Чек №214")).toBeInTheDocument();
  });

  it("fills the amount from the «Всё» and «Половина» chips", () => {
    setup(301);
    const input = screen.getByLabelText("Сумма") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /^Всё/ }));
    expect(input.value).toBe("301");
    fireEvent.click(screen.getByRole("button", { name: "Половина" }));
    expect(input.value).toBe("150");
  });
});
