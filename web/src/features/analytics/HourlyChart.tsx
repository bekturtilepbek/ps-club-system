import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AnalyticsLoadResponse } from "@/lib/api";

const TICK = { fill: "hsl(var(--fg-muted))", fontSize: 12 };

export function HourlyChart({ hourly }: { hourly: AnalyticsLoadResponse["hourly"] }) {
  const data = hourly.map((item) => ({ hour: item.hour, load_percent: Math.round(item.load_percent) }));
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="mb-3 font-display text-lg font-bold">Средняя загрузка по часам</h2>
      <div role="img" aria-label="Средняя загрузка по часам" className="h-[240px]">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data}>
            <CartesianGrid stroke="hsl(var(--line))" vertical={false} />
            <XAxis dataKey="hour" tick={TICK} stroke="hsl(var(--line))" tickFormatter={(hour: number) => `${hour}:00`} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} tick={TICK} stroke="hsl(var(--line))" tickFormatter={(value: number) => `${value}%`} />
            <Tooltip
              formatter={(value: number) => `${value}%`}
              labelFormatter={(hour: number) => `${hour}:00`}
            />
            <Bar dataKey="load_percent" name="Загрузка" fill="hsl(var(--cross))" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
