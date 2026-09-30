import type { TariffResponse } from "@/lib/api";
import { formatSom } from "@/lib/format";
import { cn } from "@/lib/utils";

interface TariffTileProps {
  tariff: TariffResponse;
  selected: boolean;
  onSelect: () => void;
  /** "+" on the extend sheet. */
  prefix?: string;
  endsLabel: string;
  /** Ends after the planned close: advisory, the operator decides. */
  late?: boolean;
}

function priceLabel(tariff: TariffResponse): string {
  return tariff.kind === "package" ? formatSom(tariff.price ?? 0) : `${formatSom(tariff.hourly_rate ?? 0)}/ч, поминутно`;
}

export function TariffTile({ tariff, selected, onSelect, prefix = "", endsLabel, late = false }: TariffTileProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-tone={tariff.kind === "open" ? "triangle" : "cross"}
      onClick={onSelect}
      className="grid gap-0.5 rounded-xl border border-line bg-bg p-3.5 text-left transition-colors hover:border-hover-line aria-pressed:border-tone aria-pressed:shadow-[inset_0_0_0_1px_hsl(var(--c)),0_0_24px_-6px_hsl(var(--c))]"
    >
      <span className="font-display text-[22px] font-bold leading-tight">
        {prefix}
        {tariff.name}
      </span>
      <span className="text-[13.5px] text-fg-muted">{priceLabel(tariff)}</span>
      <span className={cn("mt-1.5 text-xs text-fg-faint", late && "text-status-amber-text")}>{endsLabel}</span>
    </button>
  );
}
