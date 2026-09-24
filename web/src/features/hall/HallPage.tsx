import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { serverNow } from "@/lib/clock";
import { useAuth } from "@/features/auth/useAuth";
import { BusinessDayGuard } from "./BusinessDayGuard";
import { ConsoleCard } from "./ConsoleCard";
import { ExtendSessionDialog } from "./ExtendSessionDialog";
import { PaymentDialog } from "./PaymentDialog";
import { StartSessionDialog } from "./StartSessionDialog";
import { useHallSnapshot } from "./useHallSnapshot";
import { useSessionActions } from "./useSessionActions";

const DEFAULT_WARN_MINUTES = 5;
const ACTION_ERROR = "Не удалось выполнить действие. Попробуйте ещё раз.";

type DialogState =
  | { kind: "none" }
  | { kind: "start"; consoleId: number }
  | { kind: "extend"; sessionId: number }
  | { kind: "pay"; sessionId: number }
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
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionError, setActionError] = useState<string | null>(null);
  // The single clock every card's countdown is derived from.
  const [nowMs, setNowMs] = useState(serverNow);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(serverNow()), 1000);
    return () => clearInterval(interval);
  }, []);

  const warnMinutes = settingsQuery.data?.warn_minutes ?? DEFAULT_WARN_MINUTES;
  const consoles = hall?.consoles ?? [];
  const closeDialog = () => setDialog({ kind: "none" });

  // Session-bound dialogs read their session from the live snapshot rather than
  // from a copy taken at click time: the payment dialog's balance must follow
  // split payments, and a dialog whose session has ended (e.g. stopped from
  // another tab) must not stay open against it.
  const sessionConsole = (sessionId: number) => consoles.find((c) => c.session?.id === sessionId);
  const extendTarget = dialog.kind === "extend" ? sessionConsole(dialog.sessionId) : undefined;
  const payTarget = dialog.kind === "pay" ? sessionConsole(dialog.sessionId) : undefined;

  function runSessionAction(action: () => Promise<unknown>) {
    setActionError(null);
    action().catch(() => setActionError(ACTION_ERROR));
  }

  return (
    <div data-testid="hall-page" className="min-h-screen p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Зал</h1>
        <Button variant="ghost" size="sm" onClick={() => logout()}>
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
                  onCancel={() => session && runSessionAction(() => cancel(session.id))}
                  onPay={() => session && setDialog({ kind: "pay", sessionId: session.id })}
                />
              );
            })}
          </div>
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
      {extendTarget?.session && (
        <ExtendSessionDialog
          open
          sessionId={extendTarget.session.id}
          onOpenChange={(open) => !open && closeDialog()}
          onExtended={closeDialog}
        />
      )}
      {payTarget?.session && (
        // PaymentDialog deliberately stays open after a payment so the operator
        // can split the bill; only the operator closes it.
        <PaymentDialog
          open
          sessionId={payTarget.session.id}
          balance={payTarget.balance}
          onOpenChange={(open) => !open && closeDialog()}
          onPaid={() => {}}
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
