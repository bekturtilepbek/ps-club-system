import { describe, expect, it } from "vitest";
import { groupOrders, ordersTotal, summarizeOrders } from "@/features/hall/barLines";
import type { OrderResponse } from "@/lib/api";

function order(id: number, productId: number, qty: number, unitPrice: number, minute: number): OrderResponse {
  return {
    id,
    session_id: 5,
    product_id: productId,
    qty,
    unit_price: unitPrice,
    created_at: `2026-09-30T10:${minute.toString().padStart(2, "0")}:00Z`,
  };
}

const NAMES: Record<number, string> = { 1: "Кола 0,5", 2: "Сэндвич" };
const name = (id: number) => NAMES[id];

describe("groupOrders", () => {
  it("merges rows of one product, in the order products were first added", () => {
    const lines = groupOrders([order(1, 1, 1, 60, 1), order(2, 2, 1, 120, 2), order(3, 1, 1, 60, 3)]);
    expect(lines).toEqual([
      { productId: 1, qty: 2, total: 120, removableOrderId: 3 },
      { productId: 2, qty: 1, total: 120, removableOrderId: 2 },
    ]);
  });

  it("removes a single-unit row before a multi-unit one", () => {
    const lines = groupOrders([order(1, 1, 1, 60, 1), order(2, 1, 3, 60, 2)]);
    expect(lines[0].removableOrderId).toBe(1);
  });
});

describe("summaries", () => {
  it("totals and describes the bar tab", () => {
    const orders = [order(1, 1, 1, 60, 1), order(2, 2, 1, 120, 2), order(3, 1, 1, 60, 3)];
    expect(ordersTotal(orders)).toBe(240);
    expect(summarizeOrders(orders, name)).toBe("кола 0,5 × 2, сэндвич");
  });
});
