import type { OrderResponse } from "@/lib/api";

export interface BarLine {
  productId: number;
  qty: number;
  total: number;
  /** The row "−" deletes. Each tap adds one qty-1 row and a correction removes a row (Stage 4). */
  removableOrderId: number;
}

/** One line per product, in the order products were first added. */
export function groupOrders(orders: OrderResponse[]): BarLine[] {
  const byProduct = new Map<number, OrderResponse[]>();
  for (const order of orders) {
    const rows = byProduct.get(order.product_id) ?? [];
    rows.push(order);
    byProduct.set(order.product_id, rows);
  }
  return [...byProduct.entries()].map(([productId, rows]) => {
    const newestFirst = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
    const removable = newestFirst.find((row) => row.qty === 1) ?? newestFirst[0];
    return {
      productId,
      qty: rows.reduce((sum, row) => sum + row.qty, 0),
      total: rows.reduce((sum, row) => sum + row.qty * row.unit_price, 0),
      removableOrderId: removable.id,
    };
  });
}

export function ordersTotal(orders: OrderResponse[]): number {
  return orders.reduce((sum, order) => sum + order.qty * order.unit_price, 0);
}

/** "кола 0,5 × 2, сэндвич" — what a debt is made of, without opening the session. */
export function summarizeOrders(orders: OrderResponse[], productName: (productId: number) => string): string {
  return groupOrders(orders)
    .map((line) => productName(line.productId).toLowerCase() + (line.qty > 1 ? ` × ${line.qty}` : ""))
    .join(", ");
}
