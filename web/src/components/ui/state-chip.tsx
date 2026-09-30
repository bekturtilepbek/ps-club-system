import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "./tone";

interface StateChipProps {
  tone: Tone;
  /** A face-button shape, so the status never relies on colour alone. */
  glyph?: string;
  /** Solid fill for the states that must be seen from across the room. */
  loud?: boolean;
  className?: string;
  children: ReactNode;
}

export function StateChip({ tone, glyph, loud = false, className, children }: StateChipProps) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full py-0.5 pl-1.5 pr-2.5 text-[12.5px] font-medium",
        loud ? "bg-tone font-semibold text-on-tone" : "bg-tone/15 text-tone-soft",
        className,
      )}
    >
      {glyph && (
        <span aria-hidden="true" className="grid h-4 w-4 place-items-center text-xs font-bold">
          {glyph}
        </span>
      )}
      {children}
    </span>
  );
}
