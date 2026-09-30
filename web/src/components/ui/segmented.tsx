import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SegmentedControlProps<T extends string> {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}

export function SegmentedControl<T extends string>({ options, value, onChange, ariaLabel }: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={ariaLabel} className="grid auto-cols-fr grid-flow-col rounded-xl border border-line bg-bg p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-[38px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] text-sm font-medium text-fg-muted transition-colors hover:text-fg",
            value === option.value && "bg-surface-2 text-fg shadow-sm",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
