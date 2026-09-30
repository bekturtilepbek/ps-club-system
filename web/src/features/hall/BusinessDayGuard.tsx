import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { formatClock, formatDayLabel } from "@/lib/bishkek";
import { formatAmount, formatSom } from "@/lib/format";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

interface BusinessDayGuardProps {
  businessDayOpen: boolean;
  children: ReactNode;
}

export function BusinessDayGuard({ businessDayOpen, children }: BusinessDayGuardProps) {
  const [openingCash, setOpeningCash] = useState("");
  const queryClient = useQueryClient();
  const historyQuery = useQuery({
    queryKey: ["business-day-history"],
    queryFn: api.businessDayHistory,
    enabled: !businessDayOpen,
  });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings, enabled: !businessDayOpen });

  const openMutation = useMutation({
    mutationFn: () => api.openBusinessDay(Number(openingCash)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY }),
  });

  if (businessDayOpen) return <>{children}</>;

  const lastClosed = (historyQuery.data ?? [])
    .filter((day) => day.closed_at !== null)
    .sort((a, b) => Date.parse(b.closed_at!) - Date.parse(a.closed_at!))[0];
  const openingCashValue = Number(openingCash);
  const isValidOpeningCash = openingCash.trim().length > 0 && Number.isFinite(openingCashValue) && openingCashValue >= 0;
  const settings = settingsQuery.data;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isValidOpeningCash) openMutation.mutate();
  }

  return (
    <div className="grid min-h-[60vh] place-items-center p-4">
      <form onSubmit={handleSubmit} className="gate-card">
        <div className="flex items-center gap-2 text-[13px] text-fg-muted">
          <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-status-idle" />
          День не открыт
          {lastClosed && (
            <>
              {" "}
              · прошлый закрыт {formatDayLabel(Date.parse(lastClosed.closed_at!)).slice(4)} в {formatClock(Date.parse(lastClosed.closed_at!))}
            </>
          )}
        </div>
        <div>
          <h2 className="font-display text-2xl font-extrabold tracking-tight">Открыть день</h2>
          <p className="mt-1.5 text-sm text-fg-muted">Пересчитайте наличные в кассе и введите сумму. С неё начнётся касса дня.</p>
        </div>
        <div>
          <label htmlFor="opening-cash" className="field-label">
            Наличные на начало
          </label>
          <Input
            id="opening-cash"
            type="number"
            min="0"
            inputMode="numeric"
            className="num h-12 text-xl"
            placeholder="0"
            value={openingCash}
            onChange={(event) => setOpeningCash(event.target.value)}
            autoFocus
          />
          {lastClosed && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setOpeningCash(String(lastClosed.opening_cash))}
                className="h-10 rounded-full border border-line px-3 text-[13px] text-fg-muted hover:border-hover-line hover:text-fg"
              >
                Как вчера на начало: {formatAmount(lastClosed.opening_cash)}
              </button>
            </div>
          )}
        </div>
        <Button type="submit" size="lg" disabled={!isValidOpeningCash || openMutation.isPending}>
          Открыть день{isValidOpeningCash ? ` · ${formatSom(openingCashValue)}` : ""}
        </Button>
        {openMutation.isError && (
          <p role="alert" className="text-sm text-status-circle">
            Не удалось открыть день. Попробуйте ещё раз.
          </p>
        )}
        <p className="text-[12.5px] text-fg-faint">
          {settings ? `Плановые часы — ${settings.planned_open}–${settings.planned_close}. ` : ""}День закрывается только вручную.
        </p>
      </form>
    </div>
  );
}
