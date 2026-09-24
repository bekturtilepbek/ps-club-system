import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { HallConsoleResponse } from "@/lib/api";
import { formatDuration, formatSom } from "@/lib/format";
import { computeCardTiming } from "./remainingTime";
import { useAlertSound } from "./useAlertSound";

const STATUS_LABELS: Record<string, string> = {
  free: "Свободна",
  maintenance: "Обслуживание",
  package_running: "Идёт пакет",
  package_warn: "Скоро конец",
  package_overtime: "Время вышло",
  open_running: "Открытое время",
  free_session: "Бесплатная сессия",
  service_session: "Служебная сессия",
};

interface ConsoleCardProps {
  console: HallConsoleResponse;
  nowMs: number;
  warnMinutes: number;
  onStart: () => void;
  onExtend: () => void;
  onStop: () => void;
  onCancel: () => void;
  onPay: () => void;
}

export function ConsoleCard({
  console: consoleView,
  nowMs,
  warnMinutes,
  onStart,
  onExtend,
  onStop,
  onCancel,
  onPay,
}: ConsoleCardProps) {
  const timing = computeCardTiming(consoleView, nowMs, warnMinutes);
  useAlertSound(timing.status);

  const session = consoleView.session;
  const isOvertime = timing.status === "package_overtime";
  const isWarn = timing.status === "package_warn";
  const canCancel = session != null && new Date(session.grace_until).getTime() > nowMs;

  return (
    <Card
      className={
        "flex flex-col gap-2 p-4" +
        (isOvertime ? " border-red-500 bg-red-50 animate-pulse" : isWarn ? " border-amber-400 bg-amber-50" : "")
      }
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold">{consoleView.name}</span>
        <Badge variant={isOvertime ? "destructive" : "secondary"}>{STATUS_LABELS[timing.status]}</Badge>
      </div>

      {timing.remainingMs != null && (
        <div className="font-mono text-3xl">{formatDuration(timing.remainingMs)}</div>
      )}
      {timing.overtimeMs != null && (
        <div className="font-mono text-3xl text-red-600">+{formatDuration(timing.overtimeMs)}</div>
      )}
      {timing.elapsedMs != null && (
        <div>
          <div className="text-xs text-muted-foreground">Прошло</div>
          <div className="font-mono text-3xl">{formatDuration(timing.elapsedMs)}</div>
        </div>
      )}
      {session && (
        <div className="text-sm text-muted-foreground">
          Счёт: {formatSom(timing.chargeTotal)} · Остаток: {formatSom(timing.balance)}
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-2">
        {timing.status === "free" && (
          <Button onClick={onStart} size="sm">
            Старт
          </Button>
        )}
        {session && session.status === "active" && (
          <>
            {session.kind === "paid" && (
              <Button onClick={onExtend} size="sm" variant="outline">
                Продлить
              </Button>
            )}
            <Button onClick={onStop} size="sm" variant="outline">
              Стоп
            </Button>
            {canCancel && (
              <Button onClick={onCancel} size="sm" variant="ghost">
                Отменить
              </Button>
            )}
            {session.kind === "paid" && (
              <Button onClick={onPay} size="sm" variant="outline">
                Оплата
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
