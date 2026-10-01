import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  /** Ask before closing while money is still owed (the session is already over). */
  confirmCloseWithBalance?: boolean;
  /** Called after each successful payment with the amount just recorded. */
  onPaid: (amount: number) => void;
  /**
   * Once the balance is zero the dialog offers to stop the session right here, so the
   * operator does not close it and hunt for the stop button. Omit it where the session
   * is already stopped (settling after a stop).
   */
  onStop?: () => void;
  /** "Остановить PS5-1" / "Завершить чек №5". */
  stopLabel?: string;
  /** Stopping is the likely next step (package over, walk-in bill): make it the main button. */
  stopFirst?: boolean;
}

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Наличные" },
  { value: "transfer", label: "Перевод" },
];

export function PaymentDialog({
  open,
  sessionId,
  balance,
  targetName,
  onOpenChange,
  confirmCloseWithBalance = false,
  onPaid,
  onStop,
  stopLabel = "Остановить сессию",
  stopFirst = false,
}: PaymentDialogProps) {
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [settledNow, setSettledNow] = useState(false);
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const queryClient = useQueryClient();

  const payMutation = useMutation({
    mutationFn: (paidAmount: number) => api.paySession(sessionId, paidAmount, method),
    onSuccess: (_payment, paidAmount) => {
      queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY });
      onPaid(paidAmount);
      setAmount("");
      // Don't wait for the hall refetch to show the "paid" step.
      if (paidAmount >= balance) setSettledNow(true);
    },
  });

  // The API takes whole som (int): the label and the request both use the rounded value.
  const amountValue = Math.round(Number(amount));
  const isValidAmount = amount.trim() !== "" && Number.isFinite(amountValue) && amountValue > 0;

  const paidInFull = onStop !== undefined && (balance <= 0 || settledNow);

  const handleOpenChange = (next: boolean) => {
    if (!next && confirmCloseWithBalance && balance > 0) {
      setConfirmingClose(true);
      return;
    }
    onOpenChange(next);
  };

  return (
    <>
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent tone="muted">
        {paidInFull ? (
          <>
            <SheetHeader>
              <SheetTitle>Оплачено</SheetTitle>
              {targetName && <StateChip tone="muted">{targetName}</StateChip>}
            </SheetHeader>
            <SheetBody>
              <div className="flex items-center gap-3.5 rounded-xl border border-line bg-bg px-3.5 py-4">
                <span aria-hidden className="text-3xl font-bold text-status-triangle">
                  ✓
                </span>
                <span>
                  <b className="block text-[17px] font-semibold">Остаток 0 сом</b>
                  <span className="text-[13.5px] text-fg-muted">
                    {stopFirst
                      ? "Гости уходят? Остановите сессию."
                      : "Если гости ещё играют — просто закройте окно."}
                  </span>
                </span>
              </div>
            </SheetBody>
            <SheetFooter>
              <Button
                size="lg"
                className="flex-1"
                variant={stopFirst ? "default" : "outline"}
                onClick={() => onStop?.()}
              >
                {stopLabel}
              </Button>
              <Button
                size="lg"
                className="flex-1"
                variant={stopFirst ? "outline" : "default"}
                onClick={() => onOpenChange(false)}
              >
                Закрыть
              </Button>
            </SheetFooter>
          </>
        ) : (
          <>
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
          </>
        )}
      </SheetContent>
    </Sheet>
    <Dialog open={confirmingClose} onOpenChange={setConfirmingClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Гость ещё должен {formatSom(balance)}</DialogTitle>
          <DialogDescription>
            Если закрыть окно, долг пропадёт с экрана зала. Закрыть без оплаты?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmingClose(false)}>
            Вернуться к оплате
          </Button>
          <Button
            onClick={() => {
              setConfirmingClose(false);
              onOpenChange(false);
            }}
          >
            Закрыть без оплаты
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
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
