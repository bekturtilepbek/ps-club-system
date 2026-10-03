import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentDialog } from "@/features/hall/PaymentDialog";

function renderDialog(balance = 300) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 1 }) });
  vi.stubGlobal("fetch", fetchMock);
  const onPaid = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PaymentDialog open sessionId={5} balance={balance} onOpenChange={() => {}} onPaid={onPaid} />
    </QueryClientProvider>,
  );
  return { fetchMock, onPaid };
}

const payments = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => url === "/api/sessions/5/payments");

describe("an amount larger than the balance (a typo such as 5000 instead of 500)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is not recorded on the first tap: the operator is told by how much it exceeds the balance", () => {
    const { fetchMock } = renderDialog(300);

    fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /^Внести/ }));

    expect(payments(fetchMock)).toHaveLength(0);
    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent(/больше остатка/);
    expect(warning).toHaveTextContent(/4\s700/); // 5000 - 300
  });

  it("is recorded once the operator confirms it", async () => {
    const { fetchMock, onPaid } = renderDialog(300);
    fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /^Внести/ }));

    fireEvent.click(screen.getByRole("button", { name: /^Да, внести/ }));

    await waitFor(() => expect(onPaid).toHaveBeenCalledWith(5000));
    expect(payments(fetchMock)).toHaveLength(1);
  });

  it("can be corrected back to exactly the balance", () => {
    const { fetchMock } = renderDialog(300);
    fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /^Внести/ }));

    fireEvent.click(screen.getByRole("button", { name: "Исправить" }));

    expect(screen.getByLabelText("Сумма")).toHaveValue(300);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(payments(fetchMock)).toHaveLength(0);
  });

  it("asks again if the amount is changed after the warning", () => {
    renderDialog(300);
    fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /^Внести/ }));

    fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "4000" } });

    expect(screen.queryByRole("button", { name: /^Да, внести/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Внести/ })).toBeInTheDocument();
  });

  it("does not get in the way of paying exactly the balance or less", async () => {
    const { fetchMock } = renderDialog(300);

    fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: /^Внести/ }));

    await waitFor(() => expect(payments(fetchMock)).toHaveLength(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
