import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type PaymentMethod } from "@/lib/api";
import { formatSom } from "@/lib/format";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

interface PaymentDialogProps {
  open: boolean;
  sessionId: number;
  balance: number;
  onOpenChange: (open: boolean) => void;
  onPaid: () => void;
}

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Наличные" },
  { value: "qr", label: "QR" },
  { value: "transfer", label: "Перевод" },
];

export function PaymentDialog({ open, sessionId, balance, onOpenChange, onPaid }: PaymentDialogProps) {
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const queryClient = useQueryClient();

  const payMutation = useMutation({
    mutationFn: () => api.paySession(sessionId, Number(amount), method),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY });
      onPaid();
      setAmount("");
    },
  });

  const paymentFailed = payMutation.isError;

  const amountValue = Number(amount);
  const isValidAmount = Number.isFinite(amountValue) && amountValue > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Оплата — остаток {formatSom(balance)}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="amount">Сумма</Label>
            <Input id="amount" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </div>
          <div className="flex gap-2">
            {METHODS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={method === option.value ? "default" : "outline"}
                onClick={() => setMethod(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        {paymentFailed && (
          <p className="text-sm text-red-600">Не удалось провести оплату. Попробуйте ещё раз.</p>
        )}

        <DialogFooter>
          <Button onClick={() => payMutation.mutate()} disabled={!isValidAmount || payMutation.isPending}>
            Внести
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
