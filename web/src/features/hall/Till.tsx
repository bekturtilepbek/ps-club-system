import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatHoursMinutes, formatSom, pluralRu } from "@/lib/format";

interface TillProps {
  businessDayId: number;
}

export function Till({ businessDayId }: TillProps) {
  const { data } = useQuery({
    queryKey: ["business-day-summary", businessDayId, "till"],
    queryFn: () => api.businessDaySummary(businessDayId),
  });
  if (!data || typeof data.expected_cash !== "number") return null;

  const sessions = `${data.sessions_count} ${pluralRu(data.sessions_count, ["сессия", "сессии", "сессий"])}`;

  // Three zones, read left to right: what the day earned (the headline, with its two parts
  // spelled out - cash and transfers stay apart, CLAUDE.md rule 10), what should physically
  // be in the cash drawer (a different number: it includes the opening cash), and the day's
  // activity. Revenue sits on a tinted panel so it can't be mistaken for one of its parts.
  return (
    <section
      aria-label="Касса дня"
      className="order-last grid w-full grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface sm:grid-cols-[auto_auto_1fr] min-[1281px]:order-none min-[1281px]:flex min-[1281px]:w-auto"
    >
      <div className="grid content-center gap-1 border-r border-line bg-surface-2 px-3.5 py-2.5 sm:px-4">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted">Выручка за день</span>
        <span className="leading-none">
          <span className="num text-[30px] font-extrabold max-sm:text-[26px]">{formatSom(data.revenue_total)}</span>
          <span className="ml-1.5 text-[11px] text-fg-muted">сом</span>
        </span>
        <span className="text-[12px] text-fg-muted">
          наличные <b className="num font-semibold text-fg">{formatSom(data.cash_total)}</b>
          <span aria-hidden> · </span>
          переводы <b className="num font-semibold text-fg">{formatSom(data.transfer_total)}</b>
        </span>
      </div>
      <div className="grid content-center gap-0.5 border-line px-3.5 py-2.5 sm:border-r sm:px-4">
        <span className="text-[11px] text-fg-muted">Должно быть в кассе</span>
        <span className="leading-tight">
          <span className="num text-xl font-bold">{formatSom(data.expected_cash)}</span>
          <span className="ml-1 text-[11px] text-fg-muted">сом</span>
        </span>
        <span className="text-[12px] text-fg-muted">
          {formatSom(data.opening_cash)} на начало + {formatSom(data.cash_total)} наличные
        </span>
      </div>
      <div className="col-span-2 grid content-center gap-0.5 border-t border-line px-3.5 py-2.5 sm:col-span-1 sm:border-t-0 sm:px-4">
        <span className="text-[11px] text-fg-muted">За день</span>
        <span className="text-[13px] font-medium">
          {sessions} · {formatHoursMinutes(data.minutes_total)} · бар {formatSom(data.bar_sales_total)}
        </span>
      </div>
    </section>
  );
}
