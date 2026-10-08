import type { AnalyticsSummaryResponse } from "@/lib/api";
import { formatHoursMinutes, formatSom } from "@/lib/format";
import { cn } from "@/lib/utils";
import { changeTone, formatChange } from "./analyticsModel";

type ChangeKey = keyof AnalyticsSummaryResponse["changes"];

function Card({
  label,
  value,
  lines,
  change,
  neutral = false,
}: {
  label: string;
  value: string;
  lines?: string[];
  change?: number | null;
  /** More or less of this is not simply good or bad: show the arrow without a colour verdict. */
  neutral?: boolean;
}) {
  const tone = change === undefined ? null : changeTone(change);
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="text-[13px] text-fg-muted">{label}</div>
      <div className="num mt-1 font-display text-2xl font-extrabold">{value}</div>
      {lines?.map((line) => (
        <div key={line} className="text-[13px] text-fg-muted">
          {line}
        </div>
      ))}
      {change !== undefined && change !== null && (
        <div
          className={cn(
            "mt-1 text-[13px] font-medium",
            !neutral && tone === "up" && "text-status-triangle",
            !neutral && tone === "down" && "text-status-circle",
            (neutral || tone === "flat") && "text-fg-muted",
          )}
        >
          {tone === "up" && <span aria-hidden="true">▲ </span>}
          {tone === "down" && <span aria-hidden="true">▼ </span>}
          <span>{formatChange(change)}</span>
          <span className="font-normal text-fg-muted"> к прошлому периоду</span>
        </div>
      )}
    </div>
  );
}

export function SummaryCards({ data }: { data: AnalyticsSummaryResponse }) {
  const { current, changes } = data;
  const change = (key: ChangeKey) => changes[key] ?? null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-5">
        <Card
          label="Выручка"
          value={formatSom(current.revenue_total)}
          lines={[
            `нал. ${formatSom(current.cash_total)} · перевод ${formatSom(current.transfer_total)}`,
          ]}
          change={change("revenue_total")}
        />
        <Card label="Платные сессии" value={String(current.paid_sessions_count)} change={change("paid_sessions_count")} />
        <Card
          label="Средний чек"
          value={current.avg_check === null ? "—" : formatSom(current.avg_check)}
          lines={[
            current.bar_per_session === null
              ? "бар на сессию: —"
              : `бар на сессию: ${formatSom(current.bar_per_session)}`,
          ]}
          change={change("avg_check")}
        />
        <Card label="Бесплатные часы" value={formatHoursMinutes(current.free_minutes)} change={change("free_minutes")} neutral />
        <Card label="Бар" value={formatSom(current.bar_sales_total)} change={change("bar_sales_total")} />
      </div>
      {data.includes_open_day && (
        <p className="text-[13px] text-fg-muted">Сегодняшний день ещё открыт, цифры предварительные</p>
      )}
      {current.service_minutes > 0 && (
        <p className="text-[13px] text-fg-muted">Служебное время: {formatHoursMinutes(current.service_minutes)}</p>
      )}
    </div>
  );
}
