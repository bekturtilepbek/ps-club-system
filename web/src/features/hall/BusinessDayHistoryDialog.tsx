import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { formatSom } from "@/lib/format";

interface BusinessDayHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bishkek" });
}

export function BusinessDayHistoryDialog({ open, onOpenChange }: BusinessDayHistoryDialogProps) {
  const historyQuery = useQuery({
    queryKey: ["business-day-history"],
    queryFn: api.businessDayHistory,
    enabled: open,
  });

  const days = (historyQuery.data ?? []).filter((day) => day.closed_at !== null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>История рабочих дней</DialogTitle>
        </DialogHeader>

        {historyQuery.isLoading ? (
          <div>Загрузка…</div>
        ) : days.length === 0 ? (
          <p className="text-sm text-muted-foreground">Закрытых дней пока нет.</p>
        ) : (
          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
            {days.map((day) => {
              const discrepancy = (day.counted_cash ?? 0) - (day.expected_cash ?? 0);
              return (
                <div key={day.id} className="flex flex-col gap-1 rounded border p-2 text-sm">
                  <span>
                    {formatDateTime(day.opened_at)} — {day.closed_at && formatDateTime(day.closed_at)}
                  </span>
                  <span>
                    Начало: {formatSom(day.opening_cash)} · Ожидалось:{" "}
                    {formatSom(day.expected_cash ?? 0)} · Посчитано: {formatSom(day.counted_cash ?? 0)}
                  </span>
                  {discrepancy !== 0 && (
                    <span className="text-red-600">
                      Расхождение: {discrepancy > 0 ? "+" : ""}
                      {formatSom(discrepancy)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
