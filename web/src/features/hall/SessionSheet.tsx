import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StateChip } from "@/components/ui/state-chip";
import { api, type HallConsoleResponse } from "@/lib/api";
import { formatClock } from "@/lib/bishkek";
import { formatSom } from "@/lib/format";
import { ordersTotal, summarizeOrders } from "./barLines";
import { STATUS_VISUALS } from "./cardModel";
import { computeCardTiming } from "./remainingTime";
import { sessionTimeline } from "./sessionTimeline";

interface SessionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consoleView: HallConsoleResponse;
  nowMs: number;
  warnMinutes: number;
  productName: (productId: number) => string;
  onPay: () => void;
  onExtend: () => void;
  onBar: () => void;
  onStop: () => void;
  stopping?: boolean;
}

export function SessionSheet({
  open,
  onOpenChange,
  consoleView,
  nowMs,
  warnMinutes,
  productName,
  onPay,
  onExtend,
  onBar,
  onStop,
  stopping = false,
}: SessionSheetProps) {
  const tariffsQuery = useQuery({ queryKey: ["tariffs"], queryFn: api.tariffs, enabled: open });
  const session = consoleView.session;
  if (!session) return null;

  const timing = computeCardTiming(consoleView, nowMs, warnMinutes);
  const visual = STATUS_VISUALS[timing.status];
  const tariffName = (id: number | null) => tariffsQuery.data?.find((tariff) => tariff.id === id)?.name;
  const rows = sessionTimeline(session, tariffName, nowMs);
  const bar = ordersTotal(session.orders);
  const lastSegment = session.segments[session.segments.length - 1];
  const canExtend = session.kind === "paid" && lastSegment?.kind === "package";
  const owes = timing.balance > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent tone={visual.tone}>
        <SheetHeader>
          <SheetTitle>{consoleView.name}</SheetTitle>
          <StateChip tone={visual.tone} glyph={visual.glyph} loud={visual.loud}>
            {visual.label}
          </StateChip>
        </SheetHeader>
        <SheetBody>
          {session.game && (
            <p className="text-[13.5px] text-fg-muted">
              Играют: <b className="font-medium text-fg">{session.game}</b>
            </p>
          )}
          <section>
            <h3 className="field-label">Отрезки</h3>
            <ol className="grid">
              {rows.map((row, index) => (
                <li key={row.key} data-tone={row.tone} className="relative grid grid-cols-[52px_14px_1fr_auto] items-start gap-2.5 pb-3.5">
                  <time className="num pt-px text-[13px] text-fg-muted">{formatClock(row.atMs)}</time>
                  <span aria-hidden className="mt-[5px] h-2.5 w-2.5 rounded-full bg-tone shadow-[0_0_8px_hsl(var(--c))]" />
                  {index < rows.length - 1 && <span aria-hidden className="absolute bottom-0.5 left-[66px] top-[18px] w-0.5 bg-line" />}
                  <span>
                    <b className="block font-medium">{row.title}</b>
                    {row.note && <span className="text-[13px] text-fg-muted">{row.note}</span>}
                  </span>
                  <span className="num">{row.amount === null ? "—" : formatSom(row.amount)}</span>
                </li>
              ))}
            </ol>
          </section>

          {session.kind !== "service" && (
            <section>
              <h3 className="field-label">Счёт</h3>
              <dl className="rounded-xl border border-line bg-bg px-3.5 py-1.5">
                <BillRow label="Время" value={formatSom(timing.chargeTotal - bar)} />
                <BillRow
                  label="Бар"
                  note={bar > 0 ? summarizeOrders(session.orders, productName) : undefined}
                  value={formatSom(bar)}
                />
                <BillRow label="Оплачено" value={formatSom(consoleView.paid_total)} />
                <div className="flex items-baseline justify-between py-2.5">
                  <dt className="text-[13.5px] text-fg-muted">К оплате</dt>
                  <dd data-testid="bill-due" className="num text-[26px] font-bold">
                    {formatSom(Math.max(0, timing.balance))}
                  </dd>
                </div>
              </dl>
              <Button variant="outline" className="mt-2 w-full" onClick={onBar} disabled={stopping}>
                Добавить из бара
              </Button>
            </section>
          )}

          {canExtend && (
            <Button variant="outline" onClick={onExtend} disabled={stopping}>
              Продлить
            </Button>
          )}
        </SheetBody>
        <SheetFooter>
          <Button variant={owes ? "outline" : "default"} onClick={onStop} disabled={stopping}>
            Завершить сессию
          </Button>
          {owes && <Button onClick={onPay} disabled={stopping}>Принять {formatSom(timing.balance)}</Button>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function BillRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-line py-2.5">
      <dt className="text-[13.5px] text-fg-muted">
        {label}
        {note && <small className="block text-[11.5px] text-fg-faint">{note}</small>}
      </dt>
      <dd className="num text-base">{value}</dd>
    </div>
  );
}
