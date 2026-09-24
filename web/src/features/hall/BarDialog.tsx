import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, type OrderResponse } from "@/lib/api";
import { formatSom } from "@/lib/format";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

interface BarDialogProps {
  open: boolean;
  sessionId: number;
  orders: OrderResponse[];
  onOpenChange: (open: boolean) => void;
}

export function BarDialog({ open, sessionId, orders, onOpenChange }: BarDialogProps) {
  const productsQuery = useQuery({ queryKey: ["products"], queryFn: api.products, enabled: open });
  const queryClient = useQueryClient();
  const invalidateHall = () => queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY });

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
  const subtotal = orders.reduce((sum, order) => sum + order.qty * order.unit_price, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Бар — на счету {formatSom(subtotal)}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-1">
          {orders.length === 0 && (
            <p className="text-sm text-muted-foreground">Пока ничего не добавлено</p>
          )}
          {orders.map((order) => (
            <div key={order.id} className="flex items-center justify-between text-sm">
              <span>
                {order.qty} × {productName(order.product_id)} — {formatSom(order.qty * order.unit_price)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeMutation.mutate(order.id)}
                disabled={removeMutation.isPending}
              >
                Убрать
              </Button>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Добавить</p>
          {(productsQuery.data ?? []).map((product) => (
            <Button
              key={product.id}
              type="button"
              variant="outline"
              size="sm"
              className="justify-between"
              onClick={() => addMutation.mutate(product.id)}
              disabled={addMutation.isPending}
            >
              <span>{product.name}</span>
              <span>{formatSom(product.price)}</span>
            </Button>
          ))}
        </div>

        {addMutation.isError && (
          <p className="text-sm text-red-600">Не удалось добавить товар. Попробуйте ещё раз.</p>
        )}
        {removeMutation.isError && (
          <p className="text-sm text-red-600">Не удалось убрать товар. Попробуйте ещё раз.</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Готово
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
