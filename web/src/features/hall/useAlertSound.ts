import { useEffect, useRef } from "react";
import type { CardStatus } from "./remainingTime";

function beep(frequency: number, durationMs: number): void {
  const ctx = new AudioContext();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.frequency.value = frequency;
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  oscillator.start();
  oscillator.stop(ctx.currentTime + durationMs / 1000);
  oscillator.onended = () => ctx.close();
}

export function useAlertSound(status: CardStatus): void {
  const previous = useRef<CardStatus>(status);

  useEffect(() => {
    if (previous.current !== status) {
      if (status === "package_warn") beep(880, 300);
      if (status === "package_overtime") beep(440, 600);
      previous.current = status;
    }
  }, [status]);
}
