import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/api";
import { serverNow } from "@/lib/clock";
import { capitalize, formatAmount } from "@/lib/format";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useAuth } from "@/features/auth/useAuth";
import { BarDialog } from "./BarDialog";
import { BusinessDayGuard } from "./BusinessDayGuard";
import { CloseBusinessDayDialog } from "./CloseBusinessDayDialog";
import { ConsoleCard } from "./ConsoleCard";
import { DayFeed } from "./DayFeed";
import { ExtendSessionDialog } from "./ExtendSessionDialog";
import { HallHelp } from "./HallHelp";
import { HistoryPage } from "./HistoryPage";
import { PaymentDialog } from "./PaymentDialog";
import { SessionSheet } from "./SessionSheet";
import { StartSessionDialog } from "./StartSessionDialog";
import { TopBar } from "./TopBar";
import { summarizeOrders } from "./barLines";
import { hallColumns } from "./cardModel";
import { computeCardTiming } from "./remainingTime";
import { HALL_QUERY_KEY, useHallSnapshot } from "./useHallSnapshot";
import { useHallHotkeys } from "./useHallHotkeys";
import { useSessionActions } from "./useSessionActions";
import type { HallConsoleResponse, SessionResponse } from "@/lib/api";

const DEFAULT_WARN_MINUTES = 5;
const ACTION_ERROR = "Не удалось выполнить действие. Попробуйте ещё раз.";

type DialogState =
  | { kind: "none" }
  | { kind: "start"; consoleId: number }
  | { kind: "extend"; sessionId: number }
  | { kind: "pay"; sessionId: number }
  | { kind: "bar"; sessionId: number }
  | { kind: "details"; consoleId: number }
  // Paying off a session this tab just stopped. A finished session is no longer
  // in the hall snapshot, so its balance comes from the stop response and is
  // tracked here; the charge is frozen once stopped, so only payments made
  // through this dialog change it.
  | { kind: "settle"; sessionId: number; balance: number; returnTo?: "close-day" }
  | { kind: "close-day" }
  | { kind: "feed" };

export function HallPage() {
  const { logout } = useAuth();
  const { data: hall } = useHallSnapshot();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const { stop, cancel, stopping } = useSessionActions();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [view, setView] = useState<"hall" | "history">("hall");
  const [nowMs, setNowMs] = useState(serverNow);
  const wide = useMediaQuery("(min-width: 1680px)");
  const dayId = hall?.business_day_open ? hall.business_day_id : null;
  // On a wide screen the feed is a permanent column beside the hall (never on the history view).
  const showRail = wide && view === "hall" && dayId !== null;

  useEffect(() => {
    const interval = setInterval(() => setNowMs(serverNow()), 1000);
    return () => clearInterval(interval);
  }, []);

  const warnMinutes = settingsQuery.data?.warn_minutes ?? DEFAULT_WARN_MINUTES;
  const consoles = hall?.consoles ?? [];
  const tickets = hall?.tickets ?? [];
  const productsQuery = useQuery({ queryKey: ["products"], queryFn: api.products });
  const productName = (productId: number) =>
    productsQuery.data?.find((product) => product.id === productId)?.name ?? `Товар ${productId}`;
  const statuses = consoles.map((c) => computeCardTiming(c, nowMs, warnMinutes).status);
  const busyCount = consoles.filter((c) => c.session !== null).length;
  const alertCount = statuses.filter((st) => st === "package_warn" || st === "package_overtime").length;
  const closeDialog = () => setDialog({ kind: "none" });

  // A session lives either on a console or, for a walk-in bar sale, in `tickets`;
  // dialogs read the live snapshot by id rather than a copy taken at click time.
  const findSession = (sessionId: number): SessionResponse | undefined =>
    consoles.find((c) => c.session?.id === sessionId)?.session ??
    tickets.find((t) => t.id === sessionId);

  const openConsole = useCallback(
    (consoleView: HallConsoleResponse) => {
      // A console under maintenance has nothing to open: it cannot take a session.
      if (!consoleView.is_active) return;
      setDialog(
        consoleView.session
          ? { kind: "details", consoleId: consoleView.id }
          : { kind: "start", consoleId: consoleView.id },
      );
    },
    [],
  );
  useHallHotkeys(consoles, openConsole, hall?.business_day_open === true && view === "hall");
  const detailsConsole =
    dialog.kind === "details" ? consoles.find((c) => c.id === dialog.consoleId && c.session !== null) : undefined;

  const extendTarget = dialog.kind === "extend" ? findSession(dialog.sessionId) : undefined;
  const payTarget = dialog.kind === "pay" ? findSession(dialog.sessionId) : undefined;
  const barTarget = dialog.kind === "bar" ? findSession(dialog.sessionId) : undefined;

  function runSessionAction(action: () => Promise<unknown>) {
    setActionError(null);
    action().catch(() => setActionError(ACTION_ERROR));
  }

  function finishSession(sessionId: number, returnTo?: "close-day") {
    runSessionAction(async () => {
      const stopped = await stop(sessionId);
      if (stopped.balance > 0) {
        setDialog({ kind: "settle", sessionId: stopped.id, balance: stopped.balance, returnTo });
      } else {
        setDialog(returnTo === "close-day" ? { kind: "close-day" } : { kind: "none" });
      }
    });
  }

  const openTicketMutation = useMutation({
    mutationFn: api.openTicket,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY });
      setDialog({ kind: "bar", sessionId: created.id });
    },
  });

  return (
    <div data-testid="hall-page" className="min-h-screen">
      <TopBar
        businessDayOpen={hall?.business_day_open ?? false}
        businessDayId={hall?.business_day_id ?? null}
        snapshotAt={hall?.generated_at}
        nowMs={nowMs}
        onCloseDay={() => setDialog({ kind: "close-day" })}
        onLogout={() => logout().catch(() => {})}
      />

      <div className={showRail ? "grid grid-cols-[minmax(0,1fr)_340px]" : undefined}>
        <main className="px-4 pb-10 pt-[18px] short:pt-2.5 sm:px-6">
          {view === "hall" && (
            <div className="mb-4 flex flex-wrap items-center gap-3 short:mb-2.5">
              <h1 className="mr-1 font-display text-[26px] font-extrabold tracking-tight">Зал</h1>
              {hall?.business_day_open && (
                <>
                  <span className="inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-3 text-[13px] text-fg-muted">
                    <b className="font-semibold text-fg">
                      {busyCount} из {consoles.length}
                    </b>{" "}
                    <span>заняты</span>
                  </span>
                  {alertCount > 0 && (
                    <span className="inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-full border border-status-circle/50 bg-status-circle/10 px-3 text-[13px] text-fg">
                      <b className="font-semibold text-status-circle">{alertCount}</b>{" "}
                      <span>ждут решения</span>
                    </span>
                  )}
                </>
              )}
              <div className="ml-auto flex flex-wrap gap-2 max-sm:ml-0 max-sm:w-full max-sm:[&>button]:flex-1">
                {hall?.business_day_open && (
                  <Button variant="outline" onClick={() => runSessionAction(() => openTicketMutation.mutateAsync())}>
                    + Продажа без игры
                  </Button>
                )}
                {hall?.business_day_open && !wide && (
                  <Button variant="outline" onClick={() => setDialog({ kind: "feed" })}>
                    Лента дня
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setView("history")}>
                  История дней
                </Button>
                <HallHelp hotkeys />
              </div>
            </div>
          )}

          {actionError && (
            <p role="alert" className="mb-4 text-sm text-status-circle">
              {actionError}
            </p>
          )}

          {view === "history" ? (
            <HistoryPage onBack={() => setView("hall")} />
          ) : hall === undefined ? (
            <div>Загрузка…</div>
          ) : (
            <BusinessDayGuard businessDayOpen={hall.business_day_open}>
              <section
                aria-label="Консоли"
                className="grid grid-cols-1 gap-4 md:grid-cols-2 min-[1101px]:grid-cols-[repeat(var(--cols),minmax(0,1fr))]"
                style={{ "--cols": hallColumns(consoles.length) } as CSSProperties}
              >
                {consoles.map((consoleView, index) => {
                  const session = consoleView.session;
                  return (
                    <ConsoleCard
                      key={consoleView.id}
                      console={consoleView}
                      nowMs={nowMs}
                      warnMinutes={warnMinutes}
                      hotkey={index < 9 ? index + 1 : undefined}
                      productName={productName}
                      onOpen={() => openConsole(consoleView)}
                      onStart={() => setDialog({ kind: "start", consoleId: consoleView.id })}
                      onExtend={() => session && setDialog({ kind: "extend", sessionId: session.id })}
                      onStop={() => session && finishSession(session.id)}
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
              </section>

              {tickets.length > 0 && (
                <section className="mt-7">
                  <h2 className="field-label">Чеки без игры</h2>
                  <div className="grid gap-2">
                    {tickets.map((t) => (
                      <div
                        key={t.id}
                        className="flex flex-wrap items-center gap-3.5 rounded-xl border border-line bg-surface px-3.5 py-3"
                      >
                        <span className="num text-fg-muted">№{t.id}</span>
                        <span className="min-w-0 flex-1 text-sm text-fg-muted max-sm:basis-3/5">
                          {t.orders.length > 0 ? (
                            <b className="font-medium text-fg">{capitalize(summarizeOrders(t.orders, productName))}</b>
                          ) : (
                            "пока пусто"
                          )}
                        </span>
                        <span className="num">
                          {formatAmount(t.charge_total)}
                          <span className="ml-1 font-sans text-[11px] text-fg-muted">сом</span>
                        </span>
                        <Button variant="outline" onClick={() => setDialog({ kind: "bar", sessionId: t.id })}>
                          Бар
                        </Button>
                        {t.balance > 0 ? (
                          <Button onClick={() => setDialog({ kind: "pay", sessionId: t.id })}>
                            Принять {formatAmount(t.balance)}
                          </Button>
                        ) : (
                          <Button onClick={() => runSessionAction(() => stop(t.id))}>Завершить</Button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </BusinessDayGuard>
          )}
        </main>
        {showRail && (
          <aside aria-label="Лента дня" className="border-l border-line bg-rail px-5 pb-10 pt-5">
            <h2 className="field-label">Лента дня</h2>
            <DayFeed businessDayId={dayId} snapshotAt={hall?.generated_at} />
          </aside>
        )}
      </div>

      {dialog.kind === "start" && (
        <StartSessionDialog
          open
          consoleId={dialog.consoleId}
          consoleName={consoles.find((c) => c.id === dialog.consoleId)?.name ?? ""}
          onOpenChange={(open) => !open && closeDialog()}
          onStarted={closeDialog}
        />
      )}
      {detailsConsole && (
        <SessionSheet
          open
          onOpenChange={(open) => !open && closeDialog()}
          consoleView={detailsConsole}
          nowMs={nowMs}
          warnMinutes={warnMinutes}
          productName={productName}
          stopping={stopping}
          onPay={() => setDialog({ kind: "pay", sessionId: detailsConsole.session!.id })}
          onExtend={() => setDialog({ kind: "extend", sessionId: detailsConsole.session!.id })}
          onBar={() => setDialog({ kind: "bar", sessionId: detailsConsole.session!.id })}
          onStop={() => finishSession(detailsConsole.session!.id)}
        />
      )}
      {extendTarget && (
        <ExtendSessionDialog
          open
          sessionId={extendTarget.id}
          consoleName={consoles.find((c) => c.session?.id === extendTarget.id)?.name ?? ""}
          segments={extendTarget.segments}
          onOpenChange={(open) => !open && closeDialog()}
          onExtended={closeDialog}
        />
      )}
      {payTarget && (
        <PaymentDialog
          open
          sessionId={payTarget.id}
          balance={payTarget.balance}
          targetName={consoles.find((c) => c.session?.id === payTarget.id)?.name ?? `Чек №${payTarget.id}`}
          onOpenChange={(open) => !open && closeDialog()}
          onPaid={() => {}}
        />
      )}
      {barTarget && (
        <BarDialog
          open
          sessionId={barTarget.id}
          targetName={consoles.find((c) => c.session?.id === barTarget.id)?.name ?? `Чек №${barTarget.id}`}
          orders={barTarget.orders}
          onOpenChange={(open) => !open && closeDialog()}
        />
      )}
      {dialog.kind === "settle" && (
        <PaymentDialog
          open
          sessionId={dialog.sessionId}
          balance={dialog.balance}
          targetName={consoles.find((c) => c.session?.id === dialog.sessionId)?.name}
          onOpenChange={(open) => {
            if (open) return;
            setDialog(dialog.returnTo === "close-day" ? { kind: "close-day" } : { kind: "none" });
          }}
          onPaid={(amount) => {
            const remaining = dialog.balance - amount;
            if (remaining > 0) {
              setDialog({ ...dialog, balance: remaining });
            } else {
              setDialog(dialog.returnTo === "close-day" ? { kind: "close-day" } : { kind: "none" });
            }
          }}
        />
      )}
      {dialog.kind === "feed" && dayId !== null && (
        <Sheet open onOpenChange={(open) => !open && closeDialog()}>
          <SheetContent tone="triangle">
            <SheetHeader>
              <SheetTitle>Лента дня</SheetTitle>
            </SheetHeader>
            <SheetBody>
              <DayFeed businessDayId={dayId} snapshotAt={hall?.generated_at} />
            </SheetBody>
          </SheetContent>
        </Sheet>
      )}
      {dialog.kind === "close-day" && hall && hall.business_day_id != null && (
        <CloseBusinessDayDialog
          open
          businessDayId={hall.business_day_id}
          hall={hall}
          error={actionError}
          pending={stopping}
          onOpenChange={(open) => !open && closeDialog()}
          onFinishSession={(sessionId) => finishSession(sessionId, "close-day")}
          onClosed={closeDialog}
        />
      )}
    </div>
  );
}
