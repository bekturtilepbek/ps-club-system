import type { Tone } from "@/components/ui/tone";
import type { CardStatus } from "./remainingTime";

export interface StatusVisual {
  tone: Tone;
  /** DualSense face-button shape; "" where the label alone is enough. */
  glyph: string;
  label: string;
  /** Floods the whole card: the states the operator must notice from two metres away. */
  loud: boolean;
}

export const STATUS_VISUALS: Record<CardStatus, StatusVisual> = {
  free: { tone: "idle", glyph: "", label: "Свободна", loud: false },
  maintenance: { tone: "idle", glyph: "", label: "Обслуживание", loud: false },
  package_running: { tone: "cross", glyph: "✕", label: "Пакет", loud: false },
  package_warn: { tone: "amber", glyph: "!", label: "Скоро конец", loud: true },
  package_overtime: { tone: "circle", glyph: "○", label: "Переигрыш", loud: true },
  open_running: { tone: "triangle", glyph: "△", label: "Открытое время", loud: false },
  free_session: { tone: "square", glyph: "□", label: "Бесплатная", loud: false },
  service_session: { tone: "muted", glyph: "", label: "Служебная", loud: false },
};

export const BLOCK_MS = 15 * 60_000;

/**
 * Fill (0–1) of each 15-minute block of the running package segment. Lit blocks are
 * time still ahead, draining from the right, so "three lit blocks" reads as "under 45
 * minutes" at a glance.
 */
export function packageBlocks(remainingMs: number, segmentMs: number): number[] {
  const count = Math.max(1, Math.round(segmentMs / BLOCK_MS));
  return Array.from({ length: count }, (_, index) =>
    Math.min(1, Math.max(0, (remainingMs - index * BLOCK_MS) / BLOCK_MS)),
  );
}

/** Columns follow the console count, never the screen width alone: 6 consoles → 3×2. */
export function hallColumns(count: number): number {
  if (count <= 3) return Math.max(1, count);
  if (count <= 6) return 3;
  if (count <= 8) return 4;
  return 5;
}
