import { useRef } from "react";
import { Moon, Sun, SunMoon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useThemeMode } from "./themeContext";

const OPTIONS: { mode: ThemeMode; title: string; hint: string }[] = [
  { mode: "auto", title: "По времени суток", hint: "днём светлая, с 19:00 до 09:00 тёмная" },
  { mode: "light", title: "Светлая", hint: "для работы днём" },
  { mode: "dark", title: "Тёмная", hint: "для вечера и ночи" },
];

export function ThemeSwitch() {
  const { mode, setMode } = useThemeMode();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : SunMoon;

  return (
    <details ref={detailsRef} className="relative">
      <summary
        aria-label="Тема оформления"
        className={cn(buttonVariants({ variant: "outline", size: "icon" }), "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}
      >
        <Icon />
      </summary>
      <div
        role="group"
        aria-label="Тема оформления"
        className="absolute right-0 top-[calc(100%+8px)] z-30 grid w-[280px] gap-1 rounded-xl border border-hover-line bg-surface-2 p-1.5 shadow-[var(--shadow-lg)]"
      >
        {OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            aria-pressed={mode === option.mode}
            onClick={() => {
              setMode(option.mode);
              detailsRef.current?.removeAttribute("open");
            }}
            className="grid gap-px rounded-lg px-2.5 py-2 text-left hover:bg-hover aria-pressed:bg-surface aria-pressed:ring-1 aria-pressed:ring-hover-line"
          >
            <b className="text-sm font-semibold">{option.title}</b>
            <span className="text-[12.5px] text-fg-muted">{option.hint}</span>
          </button>
        ))}
      </div>
    </details>
  );
}
