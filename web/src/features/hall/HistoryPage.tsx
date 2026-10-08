// web/src/features/hall/HistoryPage.tsx
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StateChip } from "@/components/ui/state-chip";
import { api, type BusinessDayHistoryItem } from "@/lib/api";
import { formatClock, formatDayLabel } from "@/lib/bishkek";
import { formatHoursClock, formatHoursMinutes, formatSignedSom, formatSom, pluralRu } from "@/lib/format";
import { cn } from "@/lib/utils";

const COLUMNS =
  "md:grid-cols-[minmax(140px,1.4fr)_repeat(3,minmax(64px,1fr))_minmax(96px,1fr)_repeat(3,minmax(56px,.8fr))]";

function discrepancyOf(day: BusinessDayHistoryItem): number {
  return (day.counted_cash ?? 0) - (day.expected_cash ?? 0);
}

const dayWord = (n: number) => pluralRu(n, ["день", "дня", "дней"]);

export function HistoryPage({ onBack }: { onBack: () => void }) {
  const historyQuery = useQuery({ queryKey: ["business-day-history"], queryFn: api.businessDayHistory });
  const [selected, setSelected] = useState<BusinessDayHistoryItem | null>(null);

  const days = (historyQuery.data ?? []).filter((day) => day.closed_at !== null);
  const sum = (pick: (day: BusinessDayHistoryItem) => number) => days.reduce((total, day) => total + pick(day), 0);
  const withDiff = days.filter((day) => discrepancyOf(day) !== 0);
  const diffTotal = sum(discrepancyOf);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={onBack} autoFocus>
          ← Зал
        </Button>
        <h1 className="font-display text-[26px] font-extrabold tracking-tight">История дней</h1>
        {days.length > 0 && (
          <span className="inline-flex h-[30px] items-center rounded-full border border-line bg-surface px-3 text-[13px] text-fg-muted">
            {days.length} {pluralRu(days.length, ["закрытый", "закрытых", "закрытых"])} {dayWord(days.length)}
          </span>
        )}
      </div>

      {historyQuery.isLoading ? (
        <div>Загрузка…</div>
      ) : days.length === 0 ? (
        <p className="text-sm text-fg-muted">Закрытых дней пока нет.</p>
      ) : (
        <>
          <section
            aria-label="Итого за период"
            className="mb-4 grid w-fit max-w-full grid-cols-2 rounded-xl border border-line bg-surface sm:flex"
          >
            <Total label="Выручка за период" value={formatSom(sum((d) => d.revenue_total))} big />
            <Total label="Наличные" value={formatSom(sum((d) => d.cash_total))} />
            <Total label="Перевод" value={formatSom(sum((d) => d.transfer_total))} />
            <Total
              label="Расхождения"
              value={withDiff.length === 0 ? "всё сошлось" : formatSignedSom(diffTotal).replace(" сом", "")}
              note={withDiff.length > 0 ? `${withDiff.length} ${dayWord(withDiff.length)}` : undefined}
              className={diffTotal < 0 ? "text-status-circle" : undefined}
            />
          </section>

          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div
              aria-hidden
              className={cn(
                "hidden gap-3 bg-bg px-[18px] py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted md:grid [&>span:not(:first-child)]:text-right",
                COLUMNS,
              )}
            >
              <span>День</span>
              <span>Выручка</span>
              <span>Наличные</span>
              <span>Перевод</span>
              <span>Расхождение</span>
              <span>Сессии</span>
              <span>Игра, ч</span>
              <span>Бар</span>
            </div>
            {days.map((day) => {
              const diff = discrepancyOf(day);
              return (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => setSelected(day)}
                  className={cn(
                    "grid w-full grid-cols-4 items-center gap-x-2 gap-y-2.5 border-t border-line px-[18px] py-3 text-left text-sm first-of-type:border-t-0 hover:bg-surface-2 md:gap-3 md:first-of-type:border-t",
                    COLUMNS,
                  )}
                >
                  <span className="col-span-4 md:col-span-1">
                    <b className="block font-semibold">{formatDayLabel(Date.parse(day.opened_at))}</b>
                    <span className="text-[13px] text-fg-muted">
                      {formatClock(Date.parse(day.opened_at))} → {formatClock(Date.parse(day.closed_at!))}
                    </span>
                  </span>
                  <Cell label="Выручка" value={formatSom(day.revenue_total)} />
                  <Cell label="Наличные" value={formatSom(day.cash_total)} />
                  <Cell label="Перевод" value={formatSom(day.transfer_total)} />
                  <Cell
                    label="Расхождение"
                    value={diff === 0 ? "сошлось" : formatSignedSom(diff).replace(" сом", "")}
                    className={diff < 0 ? "text-status-circle" : diff === 0 ? "font-sans font-normal text-fg-faint" : undefined}
                  />
                  <Cell label="Сессии" value={String(day.sessions_count)} dim />
                  <Cell label="Игра, ч" value={formatHoursClock(day.minutes_total)} dim />
                  <Cell label="Бар" value={formatSom(day.bar_sales_total)} dim />
                </button>
              );
            })}
          </div>
        </>
      )}

      {selected && <DaySheet day={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

function Total({ label, value, note, big = false, className }: { label: string; value: string; note?: string; big?: boolean; className?: string }) {
  return (
    <div className="grid content-center border-l border-line px-4 py-2 first:border-l-0 max-sm:[&:nth-child(3)]:border-l-0 max-sm:[&:nth-child(n+3)]:border-t">
      <span className="text-[11px] text-fg-muted">{label}</span>
      <span className={cn("num font-bold", big ? "text-2xl" : "text-lg", className)}>
        {value}
        {note && <span className="ml-1 font-sans text-[11px] font-normal text-fg-muted">сом · {note}</span>}
      </span>
    </div>
  );
}

function Cell({ label, value, dim = false, className }: { label: string; value: string; dim?: boolean; className?: string }) {
  return (
    <span className={cn("num font-bold md:text-right", dim && "font-medium text-fg-muted", className)}>
      <span className="block font-sans text-[11px] font-medium text-fg-faint md:hidden">{label}</span>
      {value}
    </span>
  );
}

function DaySheet({ day, onClose }: { day: BusinessDayHistoryItem; onClose: () => void }) {
  const diff = discrepancyOf(day);
  const tone = diff < 0 ? "circle" : "triangle";

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent tone={tone}>
        <SheetHeader>
          <SheetTitle>{formatDayLabel(Date.parse(day.opened_at))}</SheetTitle>
          <StateChip tone={tone}>
            {formatClock(Date.parse(day.opened_at))} → {formatClock(Date.parse(day.closed_at!))}
          </StateChip>
        </SheetHeader>
        <SheetBody>
          <Section title="Выручка">
            <Row label="Всего за день" note="наличные + переводы, без остатка на начало" value={formatSom(day.revenue_total)} />
          </Section>
          <Section title="Наличные">
            <Row label="На начало" value={formatSom(day.opening_cash)} />
            <Row label="Пришло за день" value={`+${formatSom(day.cash_total)}`} />
            <Row label="Должно было быть" value={formatSom(day.expected_cash ?? 0)} />
            <Row label="Насчитали" value={formatSom(day.counted_cash ?? 0)} />
            <Row
              label="Расхождение"
              value={diff === 0 ? "сошлось" : formatSignedSom(diff)}
              className={diff < 0 ? "text-status-circle" : diff === 0 ? "text-status-triangle" : undefined}
            />
          </Section>
          <Section title="Безнал · сверяется по банку">
            <Row label="Перевод" value={formatSom(day.transfer_total)} />
          </Section>
          <Section title="Зал">
            <Row label="Сессий" value={String(day.sessions_count)} />
            <Row label="Часы игры" value={formatHoursClock(day.minutes_total)} />
            <Row label="Бесплатно" note="друзья, компенсации — отдельно от выручки" value={formatHoursMinutes(day.free_minutes_total)} />
            <Row label="Бар" value={formatSom(day.bar_sales_total)} />
          </Section>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="field-label">{title}</h3>
      <dl className="rounded-xl border border-line bg-bg px-3.5 py-1">{children}</dl>
    </section>
  );
}

function Row({ label, value, note, className }: { label: string; value: string; note?: string; className?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-line py-2.5 last:border-b-0">
      <dt className="text-[13.5px] text-fg-muted">
        <span>{label}</span>
        {note && <small className="block text-[11.5px] text-fg-faint">{note}</small>}
      </dt>
      <dd className={cn("num text-base font-bold", className)}>{value}</dd>
    </div>
  );
}
