import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type HallSnapshotResponse } from "@/lib/api";
import { formatHoursMinutes, formatSignedSom, formatSom } from "@/lib/format";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

interface ActiveEntry {
  sessionId: number;
  label: string;
  balance: number;
}

interface CloseBusinessDayDialogProps {
  open: boolean;
  businessDayId: number;
  hall: HallSnapshotResponse;
  error: string | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onFinishSession: (sessionId: number) => void;
  onClosed: () => void;
}

export function CloseBusinessDayDialog({
  open,
  businessDayId,
  hall,
  error,
  pending,
  onOpenChange,
  onFinishSession,
  onClosed,
}: CloseBusinessDayDialogProps) {
  const [countedCash, setCountedCash] = useState("");
  const queryClient = useQueryClient();

  const summaryQuery = useQuery({
    queryKey: ["business-day-summary", businessDayId],
    queryFn: () => api.businessDaySummary(businessDayId),
    enabled: open,
    // Cheap and short-lived (the dialog is open for a minute or two at most) — keeps
    // the reconciliation numbers live as the operator finishes sessions one by one.
    refetchInterval: open ? 5000 : false,
  });

  const closeMutation = useMutation({
    mutationFn: (amount: number) => api.closeBusinessDay(businessDayId, amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["business-day-history"] });
      setCountedCash("");
      onClosed();
      onOpenChange(false);
    },
  });

  const activeEntries: ActiveEntry[] = [
    ...hall.consoles
      .filter((c) => c.session != null && c.session.status === "active")
      .map((c) => ({ sessionId: c.session!.id, label: c.name, balance: c.balance })),
    ...hall.tickets.map((t) => ({ sessionId: t.id, label: `Чек №${t.id}`, balance: t.balance })),
  ];

  const summary = summaryQuery.data;
  const countedValue = Number(countedCash);
  const isValidCounted =
    countedCash.trim().length > 0 && Number.isFinite(countedValue) && countedValue >= 0;
  const discrepancy = summary && isValidCounted ? countedValue - summary.expected_cash : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[620px] gap-0 p-0">
        <DialogHeader className="border-b border-line px-6 py-5">
          <DialogTitle className="font-display text-[22px] font-bold">Закрытие дня</DialogTitle>
        </DialogHeader>

        <ol className="close-steps max-h-[70vh] overflow-y-auto px-6 max-sm:px-4">
          <li>
            <div>
              <h3 className="mb-2.5 mt-0.5 text-[15px] font-semibold">Завершить активные сессии</h3>
              {activeEntries.length > 0 ? (
                <>
                  <p className="text-sm text-fg-muted">Нельзя закрыть день, пока есть незавершённые сессии.</p>
                  <ul>
                    {activeEntries.map((entry) => (
                      <li key={entry.sessionId} aria-label={entry.label} className="flex items-center gap-2.5 py-2 text-sm">
                        <span className="min-w-0 flex-1">{entry.label}</span>
                        <span className={entry.balance > 0 ? "num" : "text-fg-muted"}>
                          {entry.balance > 0 ? formatSom(entry.balance) : "оплачено"}
                        </span>
                        <Button variant="outline" size="sm" disabled={pending} onClick={() => onFinishSession(entry.sessionId)}>
                          Завершить
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {error && (
                    <p role="alert" className="text-sm text-status-circle">
                      {error}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-fg-muted">Все сессии завершены.</p>
              )}
            </div>
          </li>

          <li>
            <div>
              <h3 className="mb-2.5 mt-0.5 text-[15px] font-semibold">Пересчитать наличные</h3>
              {activeEntries.length > 0 ? (
                <p className="text-sm text-fg-faint">После завершения сессий.</p>
              ) : summary === undefined ? (
                <div>Загрузка…</div>
              ) : (
                <>
                  <div className="flex items-baseline gap-2.5 py-2 text-sm">
                    <span className="flex-1 text-fg-muted">
                      Выручка за день
                      <small className="block text-[11.5px] text-fg-faint">
                        наличные {formatSom(summary.cash_total)} + переводы {formatSom(summary.transfer_total)}
                      </small>
                    </span>
                    <span data-testid="day-revenue" className="num text-xl font-bold">
                      {formatSom(summary.revenue_total)}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2.5 py-2 text-sm">
                    <span className="flex-1 text-fg-muted">
                      Должно быть в кассе
                      <small className="block text-[11.5px] text-fg-faint">
                        {formatSom(summary.opening_cash)} на начало + {formatSom(summary.cash_total)} за день
                      </small>
                    </span>
                    <span data-testid="expected-cash" className="num text-xl font-bold">
                      {formatSom(summary.expected_cash)}
                    </span>
                  </div>
                  <Label htmlFor="counted-cash" className="field-label">
                    Посчитано наличных
                  </Label>
                  <Input
                    id="counted-cash"
                    type="number"
                    min="0"
                    inputMode="numeric"
                    className="num h-12 text-xl"
                    placeholder="Сколько насчитали"
                    value={countedCash}
                    onChange={(event) => setCountedCash(event.target.value)}
                  />
                  <div className="flex items-baseline gap-2.5 py-2 text-sm">
                    <span className="flex-1 text-fg-muted">Расхождение</span>
                    <span
                      data-testid="discrepancy"
                      className={
                        discrepancy === null ? "num" : discrepancy === 0 ? "num text-status-triangle" : "num text-status-circle"
                      }
                    >
                      {discrepancy === null ? "—" : discrepancy === 0 ? "сходится" : formatSignedSom(discrepancy)}
                    </span>
                  </div>
                </>
              )}
            </div>
          </li>

          <li>
            <div>
              <h3 className="mb-2.5 mt-0.5 text-[15px] font-semibold">Сверить безнал с банком</h3>
              {summary && activeEntries.length === 0 ? (
                <>
                  <label className="flex min-h-10 items-center gap-2.5 py-1.5 text-sm">
                    <input type="checkbox" className="h-[18px] w-[18px] accent-[hsl(var(--triangle))]" />
                    <span className="flex-1">Перевод</span>
                    <span className="num">{formatSom(summary.transfer_total)}</span>
                  </label>
                  <p className="mt-2 text-[13px] text-fg-muted">
                    <span>Сессий: {summary.sessions_count}</span> · <span>Часы игры: {formatHoursMinutes(summary.minutes_total)}</span> ·{" "}
                    <span>Бар: {formatSom(summary.bar_sales_total)}</span>
                  </p>
                </>
              ) : (
                <p className="text-sm text-fg-faint">После завершения сессий.</p>
              )}
            </div>
          </li>
        </ol>

        {closeMutation.isError && (
          <p role="alert" className="px-6 text-sm text-status-circle">
            Не удалось закрыть день. Попробуйте ещё раз.
          </p>
        )}

        <DialogFooter className="gap-2 border-t border-line px-6 py-4 max-sm:flex-col-reverse">
          <DialogClose asChild>
            <Button variant="outline">Отмена</Button>
          </DialogClose>
          <Button
            onClick={() => closeMutation.mutate(countedValue)}
            disabled={activeEntries.length > 0 || !isValidCounted || closeMutation.isPending}
          >
            Закрыть день и отправить сводку
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
