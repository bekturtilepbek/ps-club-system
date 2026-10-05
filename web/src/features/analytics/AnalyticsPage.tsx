import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatAmount } from "@/lib/format";
import { HourlyChart } from "./HourlyChart";
import { LoadHeatmap } from "./LoadHeatmap";
import { PeriodBar } from "./PeriodBar";
import { RankTable } from "./RankTable";
import { RevenueChart } from "./RevenueChart";
import { SummaryCards } from "./SummaryCards";
import { type DateRange, type Group, type PeriodPreset, rangeForPreset } from "./periods";

export function AnalyticsPage({ onBack }: { onBack: () => void }) {
  const [preset, setPreset] = useState<PeriodPreset>("last30");
  const [custom, setCustom] = useState<DateRange>(() => rangeForPreset("last30", Date.now()));
  const [group, setGroup] = useState<Group>("day");

  // Presets are re-derived from the clock on every render so "today" rolls over at the club's midnight.
  const range: DateRange = preset === "custom" ? custom : rangeForPreset(preset, Date.now());
  const key = [range.from, range.to];

  const summary = useQuery({ queryKey: ["analytics", "summary", ...key], queryFn: () => api.analyticsSummary(range) });
  const revenue = useQuery({ queryKey: ["analytics", "revenue", group, ...key], queryFn: () => api.analyticsRevenue(range, group) });
  const load = useQuery({ queryKey: ["analytics", "load", ...key], queryFn: () => api.analyticsLoad(range) });
  const bar = useQuery({ queryKey: ["analytics", "bar", ...key], queryFn: () => api.analyticsBar(range) });
  const games = useQuery({ queryKey: ["analytics", "games", ...key], queryFn: () => api.analyticsGames(range) });

  const failed = [summary, revenue, load, bar, games].some((query) => query.isError);
  const loading = [summary, load].some((query) => query.isLoading);
  const empty =
    summary.data !== undefined &&
    summary.data.current.revenue_total === 0 &&
    summary.data.current.paid_sessions_count === 0 &&
    summary.data.current.free_minutes === 0 &&
    summary.data.current.bar_sales_total === 0;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={onBack} autoFocus>
          ← Зал
        </Button>
        <h1 className="font-display text-[26px] font-extrabold tracking-tight">Аналитика</h1>
      </div>

      <PeriodBar
        preset={preset}
        onPreset={setPreset}
        custom={custom}
        onCustom={setCustom}
        group={group}
        onGroup={setGroup}
      />

      {failed && (
        <p role="alert" className="mt-4 text-sm text-status-circle">
          Не удалось загрузить данные. Проверьте связь и попробуйте ещё раз.
        </p>
      )}
      {loading && <div className="mt-4">Загрузка…</div>}
      {empty && <p className="mt-4 text-sm text-fg-muted">Нет данных за период</p>}

      {summary.data && !empty && (
        <div className="mt-4 grid gap-4">
          <SummaryCards data={summary.data} />
          {revenue.data && <RevenueChart points={revenue.data.points} group={group} />}
          {load.data && <LoadHeatmap data={load.data} />}
          {load.data && <HourlyChart hourly={load.data.hourly} />}
          <div className="grid gap-4 md:grid-cols-2">
            <RankTable
              title="Бар"
              emptyText="Продаж бара за период нет"
              columns={[
                { key: "name", label: "Товар" },
                { key: "qty", label: "Шт.", align: "right" },
                { key: "revenue", label: "Выручка", align: "right" },
              ]}
              rows={(bar.data?.rows ?? []).map((row) => ({
                name: row.name, qty: row.qty, revenue: formatAmount(row.revenue),
              }))}
            />
            <RankTable
              title="Игры"
              emptyText="Игры не выбирались"
              columns={[
                { key: "name", label: "Игра" },
                { key: "sessions", label: "Сессий", align: "right" },
                { key: "revenue", label: "Выручка", align: "right" },
              ]}
              rows={(games.data?.rows ?? []).map((row) => ({
                name: row.name ?? "Не указана", sessions: row.sessions, revenue: formatAmount(row.revenue),
              }))}
            />
          </div>
        </div>
      )}
    </section>
  );
}
