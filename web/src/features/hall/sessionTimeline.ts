import type { Tone } from "@/components/ui/tone";
import type { SessionResponse } from "@/lib/api";
import { formatClock } from "@/lib/bishkek";
import { formatAmount } from "@/lib/format";

export interface TimelineRow {
  key: string;
  atMs: number;
  title: string;
  note: string;
  amount: number | null;
  tone: Tone;
}

/** The rows of the session details timeline: grace, every segment, and a running overtime. */
export function sessionTimeline(
  session: SessionResponse,
  tariffName: (tariffId: number | null) => string | undefined,
  nowMs: number,
): TimelineRow[] {
  const startedMs = Date.parse(session.started_at);

  if (session.kind !== "paid") {
    const free = session.kind === "free";
    return [
      {
        key: "kind",
        atMs: startedMs,
        title: free ? "Бесплатная" : "Служебная",
        note: session.reason ? `«${session.reason}»` : "",
        amount: null,
        tone: free ? "square" : "muted",
      },
    ];
  }

  const rows: TimelineRow[] = [];
  if (session.grace_until) {
    rows.push({ key: "grace", atMs: startedMs, title: "Выбор игры", note: "без оплаты", amount: null, tone: "idle" });
  }

  session.segments.forEach((segment, index) => {
    const name = tariffName(segment.tariff_id) ?? (segment.kind === "package" ? "Пакет" : "Открытое время");
    const note =
      segment.kind === "open"
        ? `${formatAmount(segment.price_snapshot)} сом/ч${segment.ends_at ? "" : " · идёт"}`
        : segment.ends_at
          ? `до ${formatClock(Date.parse(segment.ends_at))}`
          : "";
    rows.push({
      key: `segment-${segment.id}`,
      atMs: Date.parse(segment.starts_at),
      title: index === 0 ? name : `Продление: ${name}`,
      note,
      amount: segment.amount,
      tone: segment.kind === "open" ? "triangle" : "cross",
    });
  });

  const last = session.segments[session.segments.length - 1];
  if (last?.kind === "package" && last.ends_at && Date.parse(last.ends_at) <= nowMs) {
    rows.push({
      key: "overtime",
      atMs: Date.parse(last.ends_at),
      title: "Переигрыш",
      note: "не продлён",
      amount: null,
      tone: "circle",
    });
  }
  return rows;
}
