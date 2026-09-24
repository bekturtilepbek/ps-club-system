import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { serverNow } from "@/lib/clock";
import { formatSom } from "@/lib/format";
import { useAuth } from "@/features/auth/useAuth";
import { BarDialog } from "./BarDialog";
import { BusinessDayGuard } from "./BusinessDayGuard";
import { ConsoleCard } from "./ConsoleCard";
import { ExtendSessionDialog } from "./ExtendSessionDialog";
import { PaymentDialog } from "./PaymentDialog";
import { StartSessionDialog } from "./StartSessionDialog";
import { HALL_QUERY_KEY, useHallSnapshot } from "./useHallSnapshot";
import { useSessionActions } from "./useSessionActions";
import type { SessionResponse } from "@/lib/api";

const DEFAULT_WARN_MINUTES = 5;
const ACTION_ERROR = "Не удалось выполнить действие. Попробуйте ещё раз.";

type DialogState =
  | { kind: "none" }
  | { kind: "start"; consoleId: number }
  | { kind: "extend"; sessionId: number }
  | { kind: "pay"; sessionId: number }
  | { kind: "bar"; sessionId: number }
  // Paying off a session this tab just stopped. A finished session is no longer
  // in the hall snapshot, so its balance comes from the stop response and is
  // tracked here; the charge is frozen once stopped, so only payments made
  // through this dialog change it.
  | { kind: "settle"; sessionId: number; balance: number };

export function HallPage() {
  const { logout } = useAuth();
  const { data: hall } = useHallSnapshot();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const { stop, cancel } = useSessionActions();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(serverNow);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(serverNow()), 1000);
    return () => clearInterval(interval);
  }, []);

  const warnMinutes = settingsQuery.data?.warn_minutes ?? DEFAULT_WARN_MINUTES;
  const consoles = hall?.consoles ?? [];
  const tickets = hall?.tickets ?? [];
  const closeDialog = () => setDialog({ kind: "none" });

  // A session lives either on a console or, for a walk-in bar sale, in `tickets`;
  // dialogs read the live snapshot by id rather than a copy taken at click time.
  const findSession = (sessionId: number): SessionResponse | undefined =>
    consoles.find((c) => c.session?.id === sessionId)?.session ??
    tickets.find((t) => t.id === sessionId);

  const extendTarget = dialog.kind === "extend" ? findSession(dialog.sessionId) : undefined;
  const payTarget = dialog.kind === "pay" ? findSession(dialog.sessionId) : undefined;
  const barTarget = dialog.kind === "bar" ? findSession(dialog.sessionId) : undefined;

  function runSessionAction(action: () => Promise<unknown>) {
    setActionError(null);
    action().catch(() => setActionError(ACTION_ERROR));
  }

  const openTicketMutation = useMutation({
    mutationFn: api.openTicket,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY });
      setDialog({ kind: "bar", sessionId: created.id });
    },
  });

  return (
    <div data-testid="hall-page" className="min-h-screen p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Зал</h1>
        <Button variant="ghost" size="sm" onClick={() => logout().catch(() => {})}>
          Выйти
        </Button>
      </header>

      {actionError && <p className="mb-4 text-sm text-red-600">{actionError}</p>}

      {hall === undefined ? (
        <div>Загрузка…</div>
      ) : (
        <BusinessDayGuard businessDayOpen={hall.business_day_open}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {consoles.map((consoleView) => {
              const session = consoleView.session;
              return (
                <ConsoleCard
                  key={consoleView.id}
                  console={consoleView}
                  nowMs={nowMs}
                  warnMinutes={warnMinutes}
                  onStart={() => setDialog({ kind: "start", consoleId: consoleView.id })}
                  onExtend={() => session && setDialog({ kind: "extend", sessionId: session.id })}
                  onStop={() =>
                    session &&
                    runSessionAction(async () => {
                      const stopped = await stop(session.id);
                      if (stopped.balance > 0) {
                        setDialog({ kind: "settle", sessionId: stopped.id, balance: stopped.balance });
                      }
                    })
                  }
                  onCancel={() =>
                    session &&
                    runSessionAction(async () => {
                      const cancelled = await cancel(session.id);
                      if (cancelled.balance > 0) {
                        setDialog({ kind: "settle", sessionId: cancelled.id, balance: cancelled.balance });
                      }
                    })
                  }
                  onPay={() => session && setDialog({ kind: "pay", sessionId: session.id })}
                  onBar={() => session && setDialog({ kind: "bar", sessionId: session.id })}
                />
              );
            })}
          </div>

          <section className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Продажа без игры</h2>
              <Button size="sm" variant="outline" onClick={() => openTicketMutation.mutate()}>
                + Продажа
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {tickets.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded border p-2">
                  <span>
                    Чек №{t.id} — {formatSom(t.balance)}
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "bar", sessionId: t.id })}>
                      Бар
                    </Button>
                    {t.balance > 0 && (
                      <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "pay", sessionId: t.id })}>
                        Оплатить
                      </Button>
                    )}
                    {t.balance <= 0 && (
                      <Button size="sm" onClick={() => runSessionAction(() => stop(t.id))}>
                        Завершить
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </BusinessDayGuard>
      )}

      {dialog.kind === "start" && (
        <StartSessionDialog
          open
          consoleId={dialog.consoleId}
          onOpenChange={(open) => !open && closeDialog()}
          onStarted={closeDialog}
        />
      )}
      {extendTarget && (
        <ExtendSessionDialog
          open
          sessionId={extendTarget.id}
          onOpenChange={(open) => !open && closeDialog()}
          onExtended={closeDialog}
        />
      )}
      {payTarget && (
        <PaymentDialog
          open
          sessionId={payTarget.id}
          balance={payTarget.balance}
          onOpenChange={(open) => !open && closeDialog()}
          onPaid={() => {}}
        />
      )}
      {barTarget && (
        <BarDialog
          open
          sessionId={barTarget.id}
          orders={barTarget.orders}
          onOpenChange={(open) => !open && closeDialog()}
        />
      )}
      {dialog.kind === "settle" && (
        <PaymentDialog
          open
          sessionId={dialog.sessionId}
          balance={dialog.balance}
          onOpenChange={(open) => !open && closeDialog()}
          onPaid={(amount) => {
            const remaining = dialog.balance - amount;
            setDialog(remaining > 0 ? { ...dialog, balance: remaining } : { kind: "none" });
          }}
        />
      )}
    </div>
  );
}
