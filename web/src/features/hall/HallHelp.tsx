import { useRef } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDetailsDismiss } from "@/lib/useDetailsDismiss";

const LEGEND: { glyph: string; tone: string; text: string }[] = [
  { glyph: "✕", tone: "text-status-cross", text: "Пакет" },
  { glyph: "△", tone: "text-status-triangle", text: "Открытое время" },
  { glyph: "!", tone: "text-status-amber-text", text: "Скоро конец — последние минуты пакета" },
  { glyph: "○", tone: "text-status-circle", text: "Переигрыш — время пакета вышло" },
  { glyph: "□", tone: "text-status-square", text: "Бесплатная" },
];

/** Legend in a popover: learned in a day, so it should not take room on the hall. */
export function HallHelp({ hotkeys = false }: { hotkeys?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useDetailsDismiss(ref);
  return (
    <details ref={ref} className="relative max-sm:hidden">
      <summary
        aria-label="Обозначения"
        className={cn(buttonVariants({ variant: "outline", size: "icon" }), "cursor-pointer list-none font-bold [&::-webkit-details-marker]:hidden")}
      >
        ?
      </summary>
      <div className="absolute right-0 top-[calc(100%+8px)] z-30 grid w-[280px] gap-2 rounded-xl border border-hover-line bg-surface-2 px-4 py-3.5 text-[13px] text-fg-muted shadow-[var(--shadow-lg)]">
        {LEGEND.map((item) => (
          <span key={item.text} className="flex items-center gap-2">
            <span aria-hidden className={cn("grid w-4 place-items-center text-xs font-bold", item.tone)}>
              {item.glyph}
            </span>
            {item.text}
          </span>
        ))}
        <span className="flex items-center gap-2">
          <span aria-hidden className="flex w-4 gap-0.5">
            <i className="h-2 flex-1 rounded-[1px] bg-status-cross" />
            <i className="h-2 flex-1 rounded-[1px] bg-status-cross" />
          </span>
          Блок — 15 минут, горят оставшиеся
        </span>
        {hotkeys && (
          <>
            <hr className="border-line" />
            <span>
              <Kbd>1</Kbd>–<Kbd>9</Kbd> открыть консоль
            </span>
            <span>
              <Kbd>Esc</Kbd> закрыть панель
            </span>
          </>
        )}
      </div>
    </details>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-[5px] border border-b-2 border-line bg-bg px-1 text-[11px] font-semibold text-fg-faint">
      {children}
    </kbd>
  );
}
