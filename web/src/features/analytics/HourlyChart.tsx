import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AnalyticsLoadResponse } from "@/lib/api";

const TOOLTIP = {
  contentStyle: { background: "hsl(var(--surface))", border: "1px solid hsl(var(--line))", borderRadius: 8 },
  labelStyle: { color: "hsl(var(--fg))" },
  itemStyle: { color: "hsl(var(--fg))" },
};

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
              contentStyle={TOOLTIP.contentStyle}
              labelStyle={TOOLTIP.labelStyle}
              itemStyle={TOOLTIP.itemStyle}
              formatter={(value: number) => `${value}%`}
              labelFormatter={(hour: number) => `${hour}:00`}
            />
            <Bar dataKey="load_percent" name="Загрузка" fill="hsl(var(--cross))" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-fg-muted">Цифры по часам</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[12px] text-fg-muted">
              <tr>
                <th className="py-1.5 pr-2 font-medium">Час</th>
                <th className="py-1.5 pl-2 text-right font-medium">Загрузка</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.hour} className="border-t border-line">
                  <td className="py-1.5 pr-2">{`${row.hour.toString().padStart(2, "0")}:00`}</td>
                  <td className="num py-1.5 pl-2 text-right">{row.load_percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
