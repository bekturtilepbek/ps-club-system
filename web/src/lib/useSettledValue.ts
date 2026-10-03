import { useEffect, useState } from "react";

/**
 * `value`, but only once it has stopped changing for `delayMs`. The first value is used at once.
 * Used to turn a burst of hall snapshots (a quick run of taps, a second till working) into a single
 * refresh of the pieces that are rebuilt from the database on every change.
 */
export function useSettledValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
