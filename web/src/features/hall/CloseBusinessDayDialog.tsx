import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type HallSnapshotResponse } from "@/lib/api";
import { formatHoursMinutes, formatSom } from "@/lib/format";
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
  onOpenChange: (open: boolean) => void;
  onFinishSession: (sessionId: number) => void;
  onClosed: () => void;
}

export function CloseBusinessDayDialog({
  open,
  businessDayId,
  hall,
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Закрытие дня</DialogTitle>
        </DialogHeader>

        {activeEntries.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Нельзя закрыть день, пока есть незавершённые сессии.
            </p>
            {activeEntries.map((entry) => (
              <div
                key={entry.sessionId}
                className="flex items-center justify-between rounded border p-2"
              >
                <span>
                  {entry.label} — {formatSom(entry.balance)}
                </span>
                <Button size="sm" variant="outline" onClick={() => onFinishSession(entry.sessionId)}>
                  Завершить
                </Button>
              </div>
            ))}
          </div>
        ) : summary === undefined ? (
          <div>Загрузка…</div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1 text-sm">
              <span>Наличные ожидается: {formatSom(summary.expected_cash)}</span>
              <span>QR: {formatSom(summary.qr_total)}</span>
              <span>Перевод: {formatSom(summary.transfer_total)}</span>
              <span>Сессий: {summary.sessions_count}</span>
              <span>Часов: {formatHoursMinutes(summary.minutes_total)}</span>
              <span>Продажи бара: {formatSom(summary.bar_sales_total)}</span>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="counted-cash">Посчитано наличных</Label>
              <Input
                id="counted-cash"
                type="number"
                min="0"
                value={countedCash}
                onChange={(event) => setCountedCash(event.target.value)}
              />
            </div>

            {discrepancy !== null && discrepancy !== 0 && (
              <p className="text-sm text-red-600">
                Расхождение: {discrepancy > 0 ? "+" : ""}
                {formatSom(discrepancy)}
              </p>
            )}

            {closeMutation.isError && (
              <p className="text-sm text-red-600">Не удалось закрыть день. Попробуйте ещё раз.</p>
            )}

            <DialogFooter>
              <Button
                onClick={() => closeMutation.mutate(countedValue)}
                disabled={!isValidCounted || closeMutation.isPending}
              >
                Закрыть день
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
