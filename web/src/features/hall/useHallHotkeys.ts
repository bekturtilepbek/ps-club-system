import { useEffect } from "react";
import type { HallConsoleResponse } from "@/lib/api";

/** Keys 1–9 open the n-th console: the till is a keyboard-first workstation. */
export function useHallHotkeys(
  consoles: HallConsoleResponse[],
  onOpen: (consoleView: HallConsoleResponse) => void,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      // An open sheet or dialog owns the keyboard.
      if (document.querySelector('[role="dialog"]')) return;
      if (!/^[1-9]$/.test(event.key)) return;
      const consoleView = consoles[Number(event.key) - 1];
      if (!consoleView) return;
      event.preventDefault();
      onOpen(consoleView);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [consoles, onOpen, enabled]);
}
