import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BarDialog } from "@/features/hall/BarDialog";
import type { OrderResponse } from "@/lib/api";

function order(overrides: Partial<OrderResponse> = {}): OrderResponse {
  return {
    id: 1,
    session_id: 5,
    product_id: 1,
    qty: 1,
    unit_price: 80,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function renderDialog(orders: OrderResponse[]) {
  const queryClient = new QueryClient();
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <BarDialog open sessionId={5} orders={orders} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

describe("BarDialog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("adds an order for the clicked product", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/products") {
        return {
          ok: true,
          json: async () => [{ id: 1, name: "Кола", price: 80, is_active: true }],
        };
      }
      return { ok: true, json: async () => order() };
    });
    vi.stubGlobal("fetch", fetchMock);
    renderDialog([]);

    await waitFor(() => expect(screen.getByText("Кола")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Кола"));

    await waitFor(() => {
      const calls = fetchMock.mock.calls as unknown as [string, RequestInit | undefined][];
      const addCall = calls.find(([url]) => url === "/api/sessions/5/orders");
      expect(JSON.parse(addCall![1]!.body as string)).toEqual({ product_id: 1, qty: 1 });
    });
  });

  it("removes an existing order line", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/products") return { ok: true, json: async () => [] };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    renderDialog([order({ id: 7, product_id: 1, qty: 2, unit_price: 80 })]);

    fireEvent.click(screen.getByRole("button", { name: "Убрать" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === "/api/orders/7")).toBe(true),
    );
  });

  it("shows the running subtotal of the current order lines", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
    renderDialog([order({ qty: 2, unit_price: 80 })]);

    expect(screen.getByText("Бар — на счету 160 сом")).toBeInTheDocument();
  });

  it("shows an error when adding an item fails", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/products") {
        return { ok: true, json: async () => [{ id: 1, name: "Кола", price: 80, is_active: true }] };
      }
      return { ok: false, status: 400, json: async () => ({ detail: "product not found" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    renderDialog([]);

    await waitFor(() => expect(screen.getByText("Кола")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Кола"));

    await waitFor(() =>
      expect(screen.getByText("Не удалось добавить товар. Попробуйте ещё раз.")).toBeInTheDocument(),
    );
  });

  it("shows an error when removing an item fails", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/products") return { ok: true, json: async () => [] };
      return { ok: false, status: 404, json: async () => ({ detail: "order not found" }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    renderDialog([order({ id: 7 })]);

    fireEvent.click(screen.getByRole("button", { name: "Убрать" }));

    await waitFor(() =>
      expect(screen.getByText("Не удалось убрать товар. Попробуйте ещё раз.")).toBeInTheDocument(),
    );
  });
});
