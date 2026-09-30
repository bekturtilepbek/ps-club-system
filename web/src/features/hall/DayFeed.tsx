import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatClock } from "@/lib/bishkek";
import { formatAmount } from "@/lib/format";
import { describeFeedEvent } from "./feedModel";

interface DayFeedProps {
  businessDayId: number;
  /** The hall snapshot's generated_at: every hall change refreshes the feed. */
  snapshotAt: string | undefined;
}

export function DayFeed({ businessDayId, snapshotAt }: DayFeedProps) {
  const { data } = useQuery({
    queryKey: ["business-day-feed", businessDayId, snapshotAt],
    queryFn: () => api.businessDayFeed(businessDayId),
    placeholderData: keepPreviousData,
  });

  if (data === undefined) return <div className="text-sm text-fg-muted">Загрузка…</div>;
  if (data.length === 0) return <p className="text-sm text-fg-faint">Пока ничего не произошло.</p>;

  return (
    <ul aria-label="Лента дня" className="grid">
      {data.map((event, index) => {
        const line = describeFeedEvent(event);
        return (
          <li
            key={`${event.kind}-${event.session_id}-${event.at}-${index}`}
            data-tone={line.tone}
            className="grid grid-cols-[44px_16px_minmax(0,1fr)_auto] items-baseline gap-2 border-b border-dashed border-line py-2 text-[13.5px]"
          >
            <time className="num text-[12.5px] text-fg-faint">{formatClock(Date.parse(event.at))}</time>
            <span aria-hidden className="text-center text-xs font-bold text-tone">
              {line.glyph}
            </span>
            <span className="text-fg-muted">
              <b className="font-medium text-fg">{line.who}</b> · {line.what}
            </span>
            <span className="num whitespace-nowrap">
              {line.amount === null ? "" : formatAmount(line.amount)}
              {line.method && <span className="ml-1 font-sans text-[11px] text-fg-faint">{line.method}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
