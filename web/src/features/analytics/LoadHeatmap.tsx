import type { AnalyticsLoadResponse } from "@/lib/api";
import { WEEKDAYS_FULL, heatOpacity, slotLabel } from "./analyticsModel";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export function LoadHeatmap({ data }: { data: AnalyticsLoadResponse }) {
  const byWeekday = WEEKDAYS_FULL.map((_, weekday) => data.cells.filter((cell) => cell.weekday === weekday));
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="mb-2 font-display text-lg font-bold">Загрузка по дням и часам</h2>
      <div className="mb-3 grid gap-0.5 text-sm text-fg-muted">
        {data.busiest && (
          <p>
            Самое загруженное: <b className="font-semibold text-fg">{slotLabel(data.busiest.weekday, data.busiest.hour)}</b>{" "}
            — {Math.round(data.busiest.load_percent)}%
          </p>
        )}
        {data.quietest && (
          <p>
            Самое пустое: <b className="font-semibold text-fg">{slotLabel(data.quietest.weekday, data.quietest.hour)}</b>{" "}
            — {Math.round(data.quietest.load_percent)}%
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] gap-1" style={{ gridTemplateColumns: "32px repeat(24, minmax(0, 1fr))" }}>
          <div />
          {HOURS.map((hour) => (
            <div key={hour} className={`text-center text-[11px] text-fg-muted ${hour % 2 === 1 ? "max-md:hidden" : ""}`}>
              {hour}
            </div>
          ))}
          {byWeekday.map((row, weekday) => (
            <div key={weekday} className="contents">
              <div className="flex items-center text-[12px] text-fg-muted">{WEEKDAYS_FULL[weekday]}</div>
              {row.map((cell) => {
                const label = `${slotLabel(cell.weekday, cell.hour)}: ${Math.round(cell.load_percent)}%, ${cell.busy_minutes} мин`;
                return (
                  <div
                    key={cell.hour}
                    role="img"
                    aria-label={label}
                    title={label}
                    className="h-6 rounded-[3px]"
                    style={{ background: "hsl(var(--cross))", opacity: heatOpacity(cell.load_percent) }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[12px] text-fg-muted">
        <span>меньше</span>
        {[0, 25, 50, 75, 100].map((percent) => (
          <span
            key={percent}
            aria-hidden="true"
            className="h-3 w-6 rounded-[3px]"
            style={{ background: "hsl(var(--cross))", opacity: heatOpacity(percent) }}
          />
        ))}
        <span>больше</span>
      </div>
    </div>
  );
}
