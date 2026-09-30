import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, type OrderResponse } from "@/lib/api";
import { formatAmount, formatSom } from "@/lib/format";
import { groupOrders, ordersTotal, productCategories, inCategory } from "./barLines";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

interface BarDialogProps {
  open: boolean;
  sessionId: number;
  /** "PS 2" or "Чек №214". */
  targetName: string;
  orders: OrderResponse[];
  onOpenChange: (open: boolean) => void;
}

export function BarDialog({ open, sessionId, targetName, orders, onOpenChange }: BarDialogProps) {
  const [category, setCategory] = useState<string | null>(null);
  const productsQuery = useQuery({ queryKey: ["products"], queryFn: api.products, enabled: open });
  const queryClient = useQueryClient();
  const invalidateHall = () => queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY });
  const products = productsQuery.data ?? [];
  const categories = productCategories(products);
  const shown = category === null ? products : products.filter((p) => inCategory(p, category));

  // Each tap adds one qty-1 row and a correction deletes a row (Stage 4 decision): the
  // grouped −/+ view is presentation only, the API calls are unchanged.
  const addMutation = useMutation({
    mutationFn: (productId: number) => api.addOrder(sessionId, productId, 1),
    onSuccess: invalidateHall,
  });
  const removeMutation = useMutation({
    mutationFn: (orderId: number) => api.removeOrder(orderId),
    onSuccess: invalidateHall,
  });

  const productName = (productId: number) =>
    productsQuery.data?.find((p) => p.id === productId)?.name ?? `Товар ${productId}`;
  const lines = groupOrders(orders);
  const qtyOf = (productId: number) => lines.find((line) => line.productId === productId)?.qty ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent tone="muted">
        <SheetHeader>
          <SheetTitle>Бар · {targetName}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {categories.length > 0 && (
            <div role="group" aria-label="Категории" className="flex flex-wrap gap-2">
              {[null, ...categories].map((value) => (
                <button
                  key={value ?? "all"}
                  type="button"
                  aria-pressed={category === value}
                  onClick={() => setCategory(value)}
                  className="h-10 rounded-full border border-line px-3 text-[13px] text-fg-muted hover:text-fg aria-pressed:border-fg aria-pressed:bg-fg aria-pressed:font-semibold aria-pressed:text-ink"
                >
                  {value ?? "Всё"}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            {shown.map((product) => {
              const qty = qtyOf(product.id);
              return (
                <button
                  key={product.id}
                  type="button"
                  className="product-tile"
                  aria-label={`${product.name}, ${product.price} сом${qty ? `, на счёте ${qty}` : ""}`}
                  onClick={() => addMutation.mutate(product.id)}
                  disabled={addMutation.isPending}
                >
                  <span className="text-[13.5px] font-medium leading-tight">{product.name}</span>
                  <span className="num text-sm font-bold text-fg-muted">{formatAmount(product.price)}</span>
                  {qty > 0 && (
                    <span aria-hidden className="qty-badge">
                      {qty}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div>
            <span className="field-label">На счёте</span>
            {lines.length === 0 ? (
              <p className="py-2 text-[13.5px] text-fg-faint">Нажмите на товар — он сразу попадёт на счёт.</p>
            ) : (
              lines.map((line) => {
                const name = productName(line.productId);
                return (
                  <div
                    key={line.productId}
                    className="grid grid-cols-[minmax(0,1fr)_auto_64px] items-center gap-2.5 border-b border-line py-2 text-sm last:border-b-0"
                  >
                    <span>{name}</span>
                    <span className="inline-flex items-center overflow-hidden rounded-[10px] border border-line">
                      <button
                        type="button"
                        aria-label={`Убрать одну: ${name}`}
                        className="h-10 w-10 bg-surface-2 text-base hover:bg-hover"
                        onClick={() => removeMutation.mutate(line.removableOrderId)}
                        disabled={removeMutation.isPending}
                      >
                        −
                      </button>
                      <span className="num min-w-[30px] text-center font-bold">{line.qty}</span>
                      <button
                        type="button"
                        aria-label={`Добавить ещё: ${name}`}
                        className="h-10 w-10 bg-surface-2 text-base hover:bg-hover"
                        onClick={() => addMutation.mutate(line.productId)}
                        disabled={addMutation.isPending}
                      >
                        +
                      </button>
                    </span>
                    <span className="num text-right font-bold">{formatAmount(line.total)}</span>
                  </div>
                );
              })
            )}
            <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2.5">
              <span className="text-fg-muted">Бар, итого</span>
              <span data-testid="bar-total" className="num text-2xl font-extrabold">
                {formatSom(ordersTotal(orders))}
              </span>
            </div>
          </div>

          {addMutation.isError && (
            <p role="alert" className="text-sm text-status-circle">
              Не удалось добавить товар. Попробуйте ещё раз.
            </p>
          )}
          {removeMutation.isError && (
            <p role="alert" className="text-sm text-status-circle">
              Не удалось убрать товар. Попробуйте ещё раз.
            </p>
          )}
        </SheetBody>
        <SheetFooter>
          <Button size="lg" onClick={() => onOpenChange(false)}>
            Готово
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
