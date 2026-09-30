import { type ReactNode, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StateChip } from "@/components/ui/state-chip";
import { api, type BusinessDayResponse } from "@/lib/api";
import { formatClock, formatDayLabel } from "@/lib/bishkek";
import { formatAmount, formatHoursMinutes, formatSignedSom, formatSom, pluralRu } from "@/lib/format";
import { cn } from "@/lib/utils";

const COLUMNS = "grid-cols-[minmax(150px,1.4fr)_repeat(3,minmax(72px,1fr))_minmax(100px,1fr)]";

function discrepancyOf(day: BusinessDayResponse): number {
  return (day.counted_cash ?? 0) - (day.expected_cash ?? 0);
}

export function HistoryPage({ onBack }: { onBack: () => void }) {
  const historyQuery = useQuery({ queryKey: ["business-day-history"], queryFn: api.businessDayHistory });
  const [selected, setSelected] = useState<BusinessDayResponse | null>(null);

  const days = (historyQuery.data ?? []).filter((day) => day.closed_at !== null);
  const withDiff = days.filter((day) => discrepancyOf(day) !== 0);
  const diffTotal = withDiff.reduce((sum, day) => sum + discrepancyOf(day), 0);
  const dayWord = (n: number) => pluralRu(n, ["день", "дня", "дней"]);

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
          <div className="mb-4 inline-grid rounded-xl border border-line bg-surface px-4 py-2">
            <span className="text-[11px] text-fg-muted">Расхождения</span>
            <span className={cn("num text-lg font-bold", diffTotal < 0 && "text-status-circle")}>
              {withDiff.length === 0 ? "всё сошлось" : `${formatSignedSom(diffTotal)} · ${withDiff.length} ${dayWord(withDiff.length)}`}
            </span>
          </div>

          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div
              aria-hidden
              className={cn(
                "grid gap-3 bg-bg px-[18px] py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted max-md:hidden [&>span:not(:first-child)]:text-right",
                COLUMNS,
              )}
            >
              <span>День</span>
              <span>На начало</span>
              <span>Ожидалось</span>
              <span>Насчитали</span>
              <span>Расхождение</span>
            </div>
            {days.map((day) => {
              const diff = discrepancyOf(day);
              return (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => setSelected(day)}
                  className={cn(
                    "grid w-full items-center gap-3 border-t border-line px-[18px] py-3 text-left text-sm first-of-type:border-t-0 hover:bg-surface-2 max-md:grid-cols-4 max-md:gap-x-2 max-md:gap-y-2.5 md:first-of-type:border-t",
                    COLUMNS,
                  )}
                >
                  <span className="max-md:col-span-4">
                    <b className="block font-semibold">{formatDayLabel(Date.parse(day.opened_at))}</b>
                    <span className="text-[13px] text-fg-muted">
                      {formatClock(Date.parse(day.opened_at))} → {formatClock(Date.parse(day.closed_at!))}
                    </span>
                  </span>
                  <Cell label="На начало" value={formatAmount(day.opening_cash)} />
                  <Cell label="Ожидалось" value={formatAmount(day.expected_cash ?? 0)} />
                  <Cell label="Насчитали" value={formatAmount(day.counted_cash ?? 0)} />
                  <Cell
                    label="Расхождение"
                    value={diff === 0 ? "сошлось" : formatSignedSom(diff).replace(" сом", "")}
                    className={diff < 0 ? "text-status-circle" : diff === 0 ? "font-sans font-normal text-fg-faint" : undefined}
                  />
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

function Cell({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <span className={cn("num text-right font-bold max-md:text-left", className)}>
      <span className="hidden font-sans text-[11px] font-medium text-fg-faint max-md:block">{label}</span>
      {value}
    </span>
  );
}

function DaySheet({ day, onClose }: { day: BusinessDayResponse; onClose: () => void }) {
  const summaryQuery = useQuery({
    queryKey: ["business-day-summary", day.id],
    queryFn: () => api.businessDaySummary(day.id),
  });
  const summary = summaryQuery.data;
  const diff = discrepancyOf(day);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent tone={diff < 0 ? "circle" : "triangle"}>
        <SheetHeader>
          <SheetTitle>{formatDayLabel(Date.parse(day.opened_at))}</SheetTitle>
          <StateChip tone={diff < 0 ? "circle" : "triangle"}>
            {formatClock(Date.parse(day.opened_at))} → {formatClock(Date.parse(day.closed_at!))}
          </StateChip>
        </SheetHeader>
        <SheetBody>
          <Section title="Наличные">
            <Row label="На начало" value={formatAmount(day.opening_cash)} />
            {summary && <Row label="Пришло за день" value={`+${formatAmount(summary.cash_total)}`} />}
            <Row label="Должно было быть" value={formatAmount(day.expected_cash ?? 0)} />
            <Row label="Насчитали" value={formatAmount(day.counted_cash ?? 0)} />
            <Row
              label="Расхождение"
              value={diff === 0 ? "сошлось" : formatSignedSom(diff)}
              className={diff < 0 ? "text-status-circle" : diff === 0 ? "text-status-triangle" : undefined}
            />
          </Section>
          {summary === undefined ? (
            <div>Загрузка…</div>
          ) : (
            <>
              <Section title="Безнал · сверяется по банку">
                <Row label="QR" value={formatAmount(summary.qr_total)} />
                <Row label="Перевод по номеру" value={formatAmount(summary.transfer_total)} />
              </Section>
              <Section title="Зал">
                <Row label="Сессий" value={String(summary.sessions_count)} />
                <Row label="Часы игры" value={formatHoursMinutes(summary.minutes_total)} />
                <Row label="Бар" value={formatSom(summary.bar_sales_total)} />
              </Section>
            </>
          )}
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

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-line py-2.5 last:border-b-0">
      <dt className="text-[13.5px] text-fg-muted">{label}</dt>
      <dd className={cn("num text-base font-bold", className)}>{value}</dd>
    </div>
  );
}
