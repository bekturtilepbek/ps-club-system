import { useEffect, useState } from "react";
import { serverNow } from "@/lib/clock";

/** Server-corrected "now" that re-renders every `intervalMs` while `active`. */
export function useNow(active: boolean, intervalMs = 15_000): number {
  const [nowMs, setNowMs] = useState(() => serverNow());
  useEffect(() => {
    if (!active) return;
    setNowMs(serverNow());
    const interval = setInterval(() => setNowMs(serverNow()), intervalMs);
    return () => clearInterval(interval);
  }, [active, intervalMs]);
  return nowMs;
}
