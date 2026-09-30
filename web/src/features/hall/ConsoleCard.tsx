import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { StateChip } from "@/components/ui/state-chip";
import type { HallConsoleResponse, SegmentResponse, SessionResponse } from "@/lib/api";
import { formatClock } from "@/lib/bishkek";
import { formatAmount, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ordersTotal, summarizeOrders } from "./barLines";
import { STATUS_VISUALS, packageBlocks } from "./cardModel";
import { computeCardTiming, type CardTiming } from "./remainingTime";
import { useAlertSound } from "./useAlertSound";

interface ConsoleCardProps {
  console: HallConsoleResponse;
  nowMs: number;
  warnMinutes: number;
  hotkey?: number;
  productName: (productId: number) => string;
  onOpen: () => void;
  onStart: () => void;
  onExtend: () => void;
  onStop: () => void;
  onCancel: () => void;
  onPay: () => void;
  onBar: () => void;
}

export function ConsoleCard(props: ConsoleCardProps) {
  const { console: consoleView, nowMs, warnMinutes, hotkey, onOpen } = props;
  const timing = computeCardTiming(consoleView, nowMs, warnMinutes);
  useAlertSound(timing.status);

  const visual = STATUS_VISUALS[timing.status];
  const session = consoleView.session;
  const lastSegment = session?.segments[session.segments.length - 1];
  const idle = timing.status === "free" || timing.status === "maintenance";

  // Buttons sit inside the clickable card: keep their clicks from also opening the details.
  const act = (handler: () => void) => (event: MouseEvent) => {
    event.stopPropagation();
    handler();
  };
  const openOnEnter = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" && event.target === event.currentTarget) onOpen();
  };

  return (
    <article
      aria-label={consoleView.name}
      data-tone={visual.tone}
      data-status={timing.status}
      tabIndex={0}
      className="console-card"
      onClick={onOpen}
      onKeyDown={openOnEnter}
    >
      <span aria-hidden className="light-bar" />
      <div className="flex items-center gap-2">
        <span className="font-display text-xl font-extrabold tracking-tight">{consoleView.name}</span>
        {hotkey !== undefined && (
          <kbd className="hidden h-5 min-w-5 place-items-center rounded-[5px] border border-b-2 border-line bg-bg px-1 text-[11px] font-semibold text-fg-faint sm:inline-grid">
            {hotkey}
          </kbd>
        )}
        {!idle && (
          <StateChip tone={visual.tone} glyph={visual.glyph} loud={visual.loud} className="ml-auto">
            {visual.label}
          </StateChip>
        )}
      </div>

      {idle ? (
        <div className="card-timer-idle">{visual.label}</div>
      ) : (
        <div className="card-timer">{timerText(timing, session, nowMs)}</div>
      )}
      <div className="min-h-[19px] text-[13px] text-fg-muted [&_b]:font-medium [&_b]:text-fg">
        {caption(timing, session, lastSegment)}
      </div>

      <Blocks timing={timing} lastSegment={lastSegment} />
      <CardStrip {...props} timing={timing} act={act} />
      <CardBill timing={timing} consoleView={consoleView} />

      <div className="mt-auto flex gap-2 [&>button]:min-w-0 [&>button]:flex-1">
        <CardActions timing={timing} act={act} {...props} />
      </div>
    </article>
  );
}

function timerText(timing: CardTiming, session: SessionResponse | null, nowMs: number): string {
  switch (timing.status) {
    case "package_running":
    case "package_warn":
      return formatDuration(timing.remainingMs ?? 0);
    case "package_overtime":
      return `+${formatDuration(timing.overtimeMs ?? 0)}`;
    case "open_running":
      return formatDuration(timing.elapsedMs ?? 0);
    default:
      return formatDuration(session ? nowMs - Date.parse(session.started_at) : 0);
  }
}

function caption(timing: CardTiming, session: SessionResponse | null, last: SegmentResponse | undefined): ReactNode {
  if (!session) return null;
  const since = formatClock(Date.parse(session.started_at));
  switch (timing.status) {
    case "package_running":
    case "package_warn":
      return last?.ends_at ? (
        <>
          осталось · до <b>{formatClock(Date.parse(last.ends_at))}</b>
        </>
      ) : null;
    case "package_overtime":
      return last?.ends_at ? (
        <>
          время вышло в <b>{formatClock(Date.parse(last.ends_at))}</b>
        </>
      ) : null;
    case "open_running":
      return (
        <>
          идёт с {since} · <b>{formatAmount(last?.price_snapshot ?? 0)} сом/ч</b>, поминутно
        </>
      );
    case "free_session":
      return (
        <>
          идёт с {since}
          {session.reason && (
            <>
              {" "}
              · причина: <b>{session.reason}</b>
            </>
          )}
        </>
      );
    case "service_session":
      return <>идёт с {since} · служебная</>;
    default:
      return null;
  }
}

function Blocks({ timing, lastSegment }: { timing: CardTiming; lastSegment: SegmentResponse | undefined }) {
  const running = timing.status === "package_running" || timing.status === "package_warn";
  if ((running || timing.status === "package_overtime") && lastSegment?.ends_at) {
    const segmentMs = Date.parse(lastSegment.ends_at) - Date.parse(lastSegment.starts_at);
    const fills = running
      ? packageBlocks(timing.remainingMs ?? 0, segmentMs)
      : packageBlocks(segmentMs, segmentMs); // overtime: every block lit, pulsing
    return (
      <div
        aria-hidden
        className={cn("blocks my-4 flex h-2 gap-[3px] short:my-2.5", timing.status === "package_overtime" && "animate-breathe-fast")}
      >
        {fills.map((fill, index) => (
          <i key={index} style={{ "--f": fill } as CSSProperties} />
        ))}
      </div>
    );
  }
  if (timing.status === "open_running") {
    return <div aria-hidden className="blocks-flow my-[18px] h-1 animate-flow short:my-3" />;
  }
  return <div aria-hidden className="my-4 h-2 short:my-2.5" />;
}

type Act = (handler: () => void) => (event: MouseEvent) => void;

function CardStrip({
  console: consoleView,
  nowMs,
  productName,
  onCancel,
  timing,
  act,
}: ConsoleCardProps & { timing: CardTiming; act: Act }) {
  const session = consoleView.session;
  if (!session) return null;
  const base = "-mt-0.5 mb-3 flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-[13px] short:mb-2 short:py-1.5";

  if (timing.status === "package_overtime") {
    return (
      <div className={cn(base, "border border-dashed border-status-circle/60 bg-bg/25 text-fg")}>
        <span>
          Выключите ТВ на <b className="font-medium">{consoleView.name}</b>, если гости ушли
        </span>
      </div>
    );
  }

  const graceUntilMs = session.grace_until ? Date.parse(session.grace_until) : null;
  if (session.kind === "paid" && graceUntilMs !== null && graceUntilMs > nowMs) {
    return (
      <div className={cn(base, "bg-surface-2 text-fg-muted")}>
        <span className="flex-1">
          Выбор игры · <span className="num text-fg">{formatDuration(graceUntilMs - nowMs)}</span>
        </span>
        <button
          type="button"
          className="whitespace-nowrap text-[13px] text-fg underline underline-offset-[3px]"
          onClick={act(onCancel)}
        >
          Отменить без оплаты
        </button>
      </div>
    );
  }

  const bar = ordersTotal(session.orders);
  if (timing.balance > 0 && bar > 0) {
    return (
      <div className={cn(base, "border border-line text-fg-muted")}>
        <span className="min-w-0 flex-1">Не оплачен бар: {summarizeOrders(session.orders, productName)}</span>
        <span className="num font-bold text-fg">{formatAmount(Math.min(bar, timing.balance))}</span>
      </div>
    );
  }
  return null;
}

function CardBill({ timing, consoleView }: { timing: CardTiming; consoleView: HallConsoleResponse }) {
  const session = consoleView.session;
  if (!session) return null;
  const bar = ordersTotal(session.orders);
  const item = (label: string, value: number, emphasis?: "due" | "ok") => (
    <span key={label} className={cn(emphasis === "due" && "font-semibold text-fg")}>
      {label}
      <b className={cn("num block text-base font-bold text-fg", emphasis === "ok" && "text-status-triangle")}>
        {formatAmount(value)}
      </b>
    </span>
  );

  let content: ReactNode;
  switch (timing.status) {
    case "open_running":
      content = [
        item("Время", timing.chargeTotal - bar),
        item("Бар", bar),
        item("К оплате", timing.balance, "due"),
      ];
      break;
    case "free_session":
      content = bar > 0 ? item("Бар к оплате", timing.balance, "due") : <span>Без оплаты · в отчётах отдельной строкой</span>;
      break;
    case "service_session":
      content = <span>Служебная · в загрузку зала не попадает</span>;
      break;
    default:
      content = [
        item("Счёт", timing.chargeTotal),
        timing.balance > 0 ? item("К оплате", timing.balance, "due") : item("Оплачено", consoleView.paid_total, "ok"),
      ];
  }
  return <div className="mb-3 flex gap-[18px] text-[13px] text-fg-muted short:mb-2">{content}</div>;
}

function CardActions({
  timing,
  act,
  onStart,
  onExtend,
  onStop,
  onPay,
  onBar,
}: ConsoleCardProps & { timing: CardTiming; act: Act }) {
  const owes = timing.balance > 0;
  const primary = "flex-[1.7]";
  switch (timing.status) {
    case "free":
      return (
        <Button variant="state" size="lg" data-tone="cross" onClick={act(onStart)}>
          Начать сессию
        </Button>
      );
    case "maintenance":
      return null;
    case "package_running":
      return (
        <>
          <Button variant="outline" onClick={act(onExtend)}>Продлить</Button>
          <Button variant="outline" onClick={act(onBar)}>Бар</Button>
          {owes ? (
            <Button variant="state" className={primary} onClick={act(onPay)}>
              Принять {formatAmount(timing.balance)}
            </Button>
          ) : (
            <Button variant="outline" onClick={act(onStop)}>Стоп</Button>
          )}
        </>
      );
    case "package_warn":
      return (
        <>
          <Button variant="state" className={primary} onClick={act(onExtend)}>Продлить</Button>
          <Button variant="outline" onClick={act(onBar)}>Бар</Button>
          {owes ? (
            <Button variant="outline" onClick={act(onPay)}>Оплата</Button>
          ) : (
            <Button variant="outline" onClick={act(onStop)}>Стоп</Button>
          )}
        </>
      );
    case "package_overtime":
      // The card is already red: the fix stays neutral so it doesn't read as "danger".
      return (
        <>
          <Button className={primary} onClick={act(onExtend)}>Продлить</Button>
          <Button variant="outline" onClick={act(onStop)}>Завершить</Button>
        </>
      );
    case "open_running":
      return (
        <>
          <Button variant="outline" onClick={act(onBar)}>Бар</Button>
          <Button variant="state" className={primary} onClick={act(onStop)}>
            Рассчитать · {formatAmount(timing.balance)}
          </Button>
        </>
      );
    case "free_session":
      return (
        <>
          <Button variant="outline" onClick={act(onBar)}>Бар</Button>
          <Button variant="state" className={primary} onClick={act(onStop)}>Завершить</Button>
        </>
      );
    case "service_session":
      return <Button variant="state" onClick={act(onStop)}>Завершить</Button>;
  }
}
