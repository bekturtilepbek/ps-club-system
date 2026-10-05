import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AnalyticsRevenueResponse } from "@/lib/api";
import { formatAmount, formatSom } from "@/lib/format";
import { formatPeriodLabel } from "./analyticsModel";
import type { Group } from "./periods";

type RevenuePoint = AnalyticsRevenueResponse["points"][number];

const TOOLTIP = {
  contentStyle: { background: "hsl(var(--surface))", border: "1px solid hsl(var(--line))", borderRadius: 8 },
  labelStyle: { color: "hsl(var(--fg))" },
  itemStyle: { color: "hsl(var(--fg))" },
};

const TICK = { fill: "hsl(var(--fg-muted))", fontSize: 12 };

export function RevenueChart({ points, group }: { points: RevenuePoint[]; group: Group }) {
  const data = points.map((point) => ({
    key: point.period_start,
    label: formatPeriodLabel(point.period_start, group),
    cash: point.cash_total,
    transfer: point.transfer_total,
  }));
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="mb-3 font-display text-lg font-bold">Выручка</h2>
      <div role="img" aria-label="Выручка по периодам, наличные и перевод" className="h-[280px]">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data}>
            <CartesianGrid stroke="hsl(var(--line))" vertical={false} />
            <XAxis dataKey="label" tick={TICK} stroke="hsl(var(--line))" interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={TICK} stroke="hsl(var(--line))" tickFormatter={(value: number) => formatAmount(value)} />
            <Tooltip
              separator=": "
              contentStyle={TOOLTIP.contentStyle}
              labelStyle={TOOLTIP.labelStyle}
              itemStyle={TOOLTIP.itemStyle}
              formatter={(value: number) => formatSom(value)}
            />
            <Legend />
            <Bar dataKey="cash" name="Наличные" stackId="revenue" fill="hsl(var(--cross))" />
            <Bar dataKey="transfer" name="Перевод" stackId="revenue" fill="hsl(var(--triangle))" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 max-h-64 overflow-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[12px] text-fg-muted">
            <tr>
              <th className="py-1.5 pr-2 font-medium">Период</th>
              <th className="px-2 py-1.5 text-right font-medium">Наличные</th>
              <th className="px-2 py-1.5 text-right font-medium">Перевод</th>
              <th className="py-1.5 pl-2 text-right font-medium">Всего</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.key} className="border-t border-line">
                <td className="py-1.5 pr-2">{row.label}</td>
                <td className="num px-2 py-1.5 text-right">{formatAmount(row.cash)}</td>
                <td className="num px-2 py-1.5 text-right">{formatAmount(row.transfer)}</td>
                <td className="num py-1.5 pl-2 text-right font-semibold">{formatAmount(row.cash + row.transfer)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
