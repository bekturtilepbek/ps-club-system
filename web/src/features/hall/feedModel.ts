import type { Tone } from "@/components/ui/tone";
import type { FeedEventResponse } from "@/lib/api";
import { formatHoursMinutes } from "@/lib/format";

export interface FeedLine {
  glyph: string;
  tone: Tone;
  who: string;
  what: string;
  amount: number | null;
  method: string | null;
}

const METHOD_LABELS: Record<string, string> = { cash: "нал", qr: "QR", transfer: "перевод" };

export function describeFeedEvent(event: FeedEventResponse): FeedLine {
  const who = event.console_name ?? `Чек №${event.session_id}`;
  const line = (glyph: string, tone: Tone, what: string): FeedLine => ({
    glyph,
    tone,
    who,
    what,
    amount: event.kind === "payment" || event.kind === "order" ? event.amount : null,
    method: event.method ? METHOD_LABELS[event.method] : null,
  });

  switch (event.kind) {
    case "session_started":
      if (event.session_kind === "free") return line("□", "square", event.reason ? `бесплатно: «${event.reason}»` : "бесплатно");
      if (event.session_kind === "service") return line("", "muted", "служебная");
      if (event.segment_kind === "open") return line("△", "triangle", "открытое время");
      return line("✕", "cross", event.tariff_name ? `пакет ${event.tariff_name}` : "пакет");
    case "session_extended":
      if (event.segment_kind === "open") return line("△", "triangle", "переход на открытое время");
      return line("✕", "cross", event.tariff_name ? `продление: ${event.tariff_name}` : "продление");
    case "session_finished":
      return line("■", "muted", event.console_name ? `завершена, ${formatHoursMinutes(event.minutes ?? 0)}` : "чек закрыт");
    case "session_cancelled":
      return line("", "muted", "отменена без оплаты");
    case "payment":
      return line("", "idle", "оплата");
    case "order": {
      const name = (event.product_name ?? "товар").toLowerCase();
      return line("·", "muted", event.qty && event.qty > 1 ? `${name} × ${event.qty}` : name);
    }
  }
}
