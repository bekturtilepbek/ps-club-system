import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StateChip } from "@/components/ui/state-chip";
import { api, type PaymentMethod } from "@/lib/api";
import { formatAmount, formatSom } from "@/lib/format";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

interface PaymentDialogProps {
  open: boolean;
  sessionId: number;
  balance: number;
  /** "PS 2" or "Чек №214", shown in the header. */
  targetName?: string;
  onOpenChange: (open: boolean) => void;
  /** Called after each successful payment with the amount just recorded. */
  onPaid: (amount: number) => void;
}

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Наличные" },
  { value: "qr", label: "QR" },
  { value: "transfer", label: "Перевод" },
];

export function PaymentDialog({ open, sessionId, balance, targetName, onOpenChange, onPaid }: PaymentDialogProps) {
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const queryClient = useQueryClient();

  const payMutation = useMutation({
    mutationFn: (paidAmount: number) => api.paySession(sessionId, paidAmount, method),
    onSuccess: (_payment, paidAmount) => {
      queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY });
      onPaid(paidAmount);
      setAmount("");
    },
  });

  const amountValue = Number(amount);
  const isValidAmount = amount.trim() !== "" && Number.isFinite(amountValue) && amountValue > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent tone="muted">
        <SheetHeader>
          <SheetTitle>Оплата · остаток {formatSom(balance)}</SheetTitle>
          {targetName && <StateChip tone="muted">{targetName}</StateChip>}
        </SheetHeader>
        <SheetBody>
          <div className="flex items-baseline justify-between rounded-xl border border-line bg-bg px-3.5 py-3">
            <span className="text-[13.5px] text-fg-muted">К оплате</span>
            <span className="num text-[26px] font-bold">
              {formatAmount(balance)}
              <span className="ml-1 font-sans text-sm font-normal text-fg-muted">сом</span>
            </span>
          </div>
          <div>
            <span className="field-label">Способ оплаты</span>
            <SegmentedControl ariaLabel="Способ оплаты" value={method} onChange={setMethod} options={METHODS} />
          </div>
          <div>
            <label htmlFor="amount" className="field-label">
              Сумма
            </label>
            <Input
              id="amount"
              type="number"
              inputMode="numeric"
              className="num h-12 text-xl"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <ChipButton onClick={() => setAmount(String(balance))}>Всё: {formatAmount(balance)}</ChipButton>
              <ChipButton onClick={() => setAmount(String(Math.floor(balance / 2)))}>Половина</ChipButton>
            </div>
          </div>
          {payMutation.isError && (
            <p role="alert" className="text-sm text-status-circle">
              Не удалось провести оплату. Попробуйте ещё раз.
            </p>
          )}
        </SheetBody>
        <SheetFooter>
          <Button size="lg" onClick={() => payMutation.mutate(amountValue)} disabled={!isValidAmount || payMutation.isPending}>
            Внести{isValidAmount ? ` ${formatSom(amountValue)}` : ""}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ChipButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-10 rounded-full border border-line px-3 text-[13px] text-fg-muted hover:border-hover-line hover:text-fg"
    >
      {children}
    </button>
  );
}
