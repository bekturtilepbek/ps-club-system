import { type ReactNode, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatSom } from "@/lib/format";
import { HourlyChart } from "./HourlyChart";
import { LoadHeatmap } from "./LoadHeatmap";
import { PeriodBar } from "./PeriodBar";
import { RankTable } from "./RankTable";
import { RevenueChart } from "./RevenueChart";
import { SummaryCards } from "./SummaryCards";
import { type DateRange, type Group, type PeriodPreset, rangeForPreset } from "./periods";

function SectionState({ loading, error, children }: { loading: boolean; error: string | null; children: ReactNode }) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-status-circle">
        {error}
      </p>
    );
  }
  if (loading) return <div className="text-fg-muted">Загрузка…</div>;
  return <>{children}</>;
}

export function AnalyticsPage({ onBack }: { onBack: () => void }) {
  const [preset, setPreset] = useState<PeriodPreset>("last30");
  const [custom, setCustom] = useState<DateRange>(() => rangeForPreset("last30", Date.now()));
  const [group, setGroup] = useState<Group>("day");
  const [rangeError, setRangeError] = useState(false);

  // Presets are re-derived from the clock on every render so "today" rolls over at the club's midnight.
  const range: DateRange = preset === "custom" ? custom : rangeForPreset(preset, Date.now());
  const key = [range.from, range.to];

  function choosePreset(next: PeriodPreset) {
    setRangeError(false);
    setPreset(next);
  }

  // The inputs edit the range in effect; an inverted range is never queried, the last good one stays on screen.
  function editRange(next: DateRange) {
    if (next.from > next.to) {
      setRangeError(true);
      return;
    }
    setRangeError(false);
    setCustom(next);
    setPreset("custom");
  }

  const keep = { placeholderData: keepPreviousData };
  const summary = useQuery({ queryKey: ["analytics", "summary", ...key], queryFn: () => api.analyticsSummary(range), ...keep });
  const revenue = useQuery({
    queryKey: ["analytics", "revenue", group, ...key],
    queryFn: () => api.analyticsRevenue(range, group),
    ...keep,
  });
  const load = useQuery({ queryKey: ["analytics", "load", ...key], queryFn: () => api.analyticsLoad(range), ...keep });
  const bar = useQuery({ queryKey: ["analytics", "bar", ...key], queryFn: () => api.analyticsBar(range), ...keep });
  const games = useQuery({ queryKey: ["analytics", "games", ...key], queryFn: () => api.analyticsGames(range), ...keep });

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
        onPreset={choosePreset}
        range={range}
        onRange={editRange}
        rangeError={rangeError}
        group={group}
        onGroup={setGroup}
      />

      {summary.isError && (
        <p role="alert" className="mt-4 text-sm text-status-circle">
          Не удалось загрузить данные. Проверьте связь и попробуйте ещё раз.
        </p>
      )}
      {summary.isLoading && <div className="mt-4">Загрузка…</div>}
      {empty && <p className="mt-4 text-sm text-fg-muted">Нет данных за период</p>}

      {summary.data && !empty && (
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4">
          <SummaryCards data={summary.data} />
          <SectionState loading={revenue.isLoading} error={revenue.isError ? "Не удалось загрузить выручку" : null}>
            {revenue.data && <RevenueChart points={revenue.data.points} group={group} />}
          </SectionState>
          <SectionState loading={load.isLoading} error={load.isError ? "Не удалось загрузить загрузку по часам" : null}>
            {load.data && (
              <>
                <LoadHeatmap data={load.data} />
                <HourlyChart hourly={load.data.hourly} />
              </>
            )}
          </SectionState>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
            <SectionState loading={bar.isLoading} error={bar.isError ? "Не удалось загрузить бар" : null}>
              <RankTable
                title="Бар"
                emptyText="Продаж бара за период нет"
                columns={[
                  { key: "name", label: "Товар" },
                  { key: "qty", label: "Шт.", align: "right" },
                  { key: "revenue", label: "Выручка", align: "right" },
                ]}
                rows={(bar.data?.rows ?? []).map((row) => ({
                  name: row.name,
                  qty: row.qty,
                  revenue: formatSom(row.revenue),
                }))}
              />
            </SectionState>
            <SectionState loading={games.isLoading} error={games.isError ? "Не удалось загрузить игры" : null}>
              <RankTable
                title="Игры"
                emptyText="Игры не выбирались"
                columns={[
                  { key: "name", label: "Игра" },
                  { key: "sessions", label: "Сессий", align: "right" },
                  { key: "revenue", label: "Начислено", align: "right" },
                ]}
                rows={(games.data?.rows ?? []).map((row) => ({
                  name: row.name ?? "Не указана",
                  sessions: row.sessions,
                  revenue: formatSom(row.revenue),
                }))}
              />
            </SectionState>
          </div>
        </div>
      )}
    </section>
  );
}
