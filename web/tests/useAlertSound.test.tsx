import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAlertSound } from "@/features/hall/useAlertSound";
import type { CardStatus } from "@/features/hall/remainingTime";

class FakeOscillator {
  frequency = { value: 0 };
  connect() {}
  start() {}
  stop() {}
  onended: (() => void) | null = null;
}

class FakeGain {
  gain = { setValueAtTime: vi.fn() };
  connect() {}
}

class FakeAudioContext {
  currentTime = 0;
  createOscillator() {
    return new FakeOscillator();
  }
  createGain() {
    return new FakeGain();
  }
  destination = {};
  close() {}
}

describe("useAlertSound", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("beeps once when transitioning into package_warn", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const createOscillatorSpy = vi.spyOn(FakeAudioContext.prototype, "createOscillator");

    const { rerender } = renderHook<void, { status: CardStatus }>(({ status }) => useAlertSound(status), {
      initialProps: { status: "package_running" as const },
    });
    expect(createOscillatorSpy).not.toHaveBeenCalled();

    rerender({ status: "package_warn" as const });
    expect(createOscillatorSpy).toHaveBeenCalledTimes(1);

    rerender({ status: "package_warn" as const });
    expect(createOscillatorSpy).toHaveBeenCalledTimes(1); // no repeat while status is unchanged
  });

  it("beeps again on transitioning from warn into overtime", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const createOscillatorSpy = vi.spyOn(FakeAudioContext.prototype, "createOscillator");

    const { rerender } = renderHook<void, { status: CardStatus }>(({ status }) => useAlertSound(status), {
      initialProps: { status: "package_warn" as const },
    });

    rerender({ status: "package_overtime" as const });
    expect(createOscillatorSpy).toHaveBeenCalledTimes(1);
  });

  it("does not beep on mount even if the initial status is already warn", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const createOscillatorSpy = vi.spyOn(FakeAudioContext.prototype, "createOscillator");

    renderHook<void, { status: CardStatus }>(({ status }) => useAlertSound(status), {
      initialProps: { status: "package_warn" as const },
    });

    expect(createOscillatorSpy).not.toHaveBeenCalled();
  });

  it("does not beep for transitions into non-alert statuses", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const createOscillatorSpy = vi.spyOn(FakeAudioContext.prototype, "createOscillator");

    const { rerender } = renderHook<void, { status: CardStatus }>(({ status }) => useAlertSound(status), {
      initialProps: { status: "free" as const },
    });

    rerender({ status: "package_running" as const });
    rerender({ status: "open_running" as const });
    rerender({ status: "free_session" as const });
    rerender({ status: "service_session" as const });
    rerender({ status: "maintenance" as const });

    expect(createOscillatorSpy).not.toHaveBeenCalled();
  });
});
