import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatAmount, formatHoursMinutes, pluralRu } from "@/lib/format";
import { cn } from "@/lib/utils";

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

  // Cash and non-cash are always shown apart (CLAUDE.md rule 10): cash is counted,
  // transfers are checked against the bank app.
  return (
    <section
      aria-label="Касса дня"
      className="order-last grid w-full grid-cols-3 rounded-xl border border-line bg-surface min-[1281px]:order-none min-[1281px]:flex min-[1281px]:w-auto"
    >
      <TillItem label="Наличные в кассе" value={formatAmount(data.expected_cash)} big />
      <TillItem label="Перевод" value={formatAmount(data.transfer_total)} />
      <TillItem label="Выручка за день" value={formatAmount(data.revenue_total)} />
      <div className="col-span-3 grid content-center border-t border-line px-4 py-1.5 min-[1281px]:border-l min-[1281px]:border-t-0">
        <span className="text-[11px] text-fg-muted">За день</span>
        <span className="text-[13px] font-medium">
          {sessions} · {formatHoursMinutes(data.minutes_total)} · бар {formatAmount(data.bar_sales_total)}
        </span>
      </div>
    </section>
  );
}

function TillItem({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="grid min-w-0 content-center border-l border-line px-4 py-1.5 first:border-l-0">
      <span className="text-[11px] leading-tight text-fg-muted">{label}</span>
      <span className="leading-tight">
        <span className={cn("num font-bold", big ? "text-2xl max-sm:text-lg" : "text-lg max-sm:text-base")}>{value}</span>
        <span className="ml-1 text-[11px] text-fg-muted">сом</span>
      </span>
    </div>
  );
}
