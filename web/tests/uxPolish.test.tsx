import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STATUS_VISUALS, hallColumns, packageBlocks } from "@/features/hall/cardModel";
import { PaymentDialog } from "@/features/hall/PaymentDialog";
import { sessionTimeline } from "@/features/hall/sessionTimeline";
import { useHallHotkeys } from "@/features/hall/useHallHotkeys";
import type { HallConsoleResponse, SessionResponse } from "@/lib/api";

const MIN = 60_000;

describe("packageBlocks for any duration", () => {
  it("keeps 15-minute multiples as exact 15-minute blocks", () => {
    expect(packageBlocks(45 * MIN, 45 * MIN)).toEqual([1, 1, 1]);
    expect(packageBlocks(20 * MIN, 45 * MIN)).toEqual([1, 5 / 15, 0]);
    expect(packageBlocks(60 * MIN, 60 * MIN)).toEqual([1, 1, 1, 1]);
    expect(packageBlocks(180 * MIN, 180 * MIN)).toHaveLength(12);
  });
  it("renders 15 and 10 minute packages as one proportional block", () => {
    expect(packageBlocks(15 * MIN, 15 * MIN)).toEqual([1]);
    expect(packageBlocks(5 * MIN, 15 * MIN)).toEqual([1 / 3]);
    expect(packageBlocks(10 * MIN, 10 * MIN)).toEqual([1]);
    expect(packageBlocks(5 * MIN, 10 * MIN)).toEqual([0.5]);
    expect(packageBlocks(0, 10 * MIN)).toEqual([0]);
  });
});

describe("hallColumns for common console counts", () => {
  it.each([
    [2, 2],
    [5, 3],
    [7, 4],
    [9, 5],
  ])("%i consoles use %i columns", (count, cols) => {
    expect(hallColumns(count)).toBe(cols);
  });
});

describe("STATUS_VISUALS coverage", () => {
  it("has a label for every status and only warn/overtime are loud", () => {
    const entries = Object.entries(STATUS_VISUALS);
    expect(entries).toHaveLength(8);
    for (const [, visual] of entries) expect(visual.label.length).toBeGreaterThan(0);
    expect(entries.filter(([, v]) => v.loud).map(([k]) => k).sort()).toEqual(["package_overtime", "package_warn"]);
    expect(STATUS_VISUALS.package_overtime.tone).toBe("circle");
    expect(STATUS_VISUALS.open_running.glyph).toBe("△");
  });
});

function session(overrides: Partial<SessionResponse>): SessionResponse {
  return {
    id: 7, console_id: 3, business_day_id: 1, kind: "paid", reason: null, status: "active",
    started_at: "2026-09-29T14:31:00Z", grace_until: null, ended_at: null, comment: null, game: null,
    segments: [], orders: [], charge_total: 0, paid_total: 0, balance: 0,
    ...overrides,
  };
}

describe("sessionTimeline running open segment", () => {
  const open = (amount: number | null, endsAt: string | null) =>
    session({
      segments: [{ id: 1, tariff_id: 2, kind: "open", starts_at: "2026-09-29T14:34:00Z", ends_at: endsAt, price_snapshot: 120, amount }],
    });
  const amountAt = (iso: string, s: SessionResponse) =>
    sessionTimeline(s, () => "Открытое время", Date.parse(iso)).find((r) => r.key === "segment-1")!.amount;

  it("shows the accrued per-minute amount and grows with time", () => {
    expect(amountAt("2026-09-29T15:34:00Z", open(null, null))).toBe(120);
    expect(amountAt("2026-09-29T15:49:00Z", open(null, null))).toBe(150);
    expect(amountAt("2026-09-29T14:35:00Z", open(null, null))).toBe(2);
  });

  it("keeps the backend amount for a closed segment and null for a queued one", () => {
    expect(amountAt("2026-09-29T16:00:00Z", open(90, "2026-09-29T15:19:00Z"))).toBe(90);
    expect(amountAt("2026-09-29T14:00:00Z", open(null, null))).toBeNull();
  });
});

describe("PaymentDialog amounts and chips", () => {
  afterEach(() => vi.unstubAllGlobals());
  const setup = (balance: number, targetName?: string) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });
    vi.stubGlobal("fetch", fetchMock);
    const onPaid = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PaymentDialog open sessionId={5} balance={balance} targetName={targetName} onOpenChange={() => {}} onPaid={onPaid} />
      </QueryClientProvider>,
    );
    return { fetchMock, onPaid };
  };

  it("sends exactly the rounded whole-som amount shown on the button", async () => {
    const { fetchMock, onPaid } = setup(300);
    fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "99.6" } });
    const button = screen.getByRole("button", { name: /^Внести/ });
    expect(button.textContent).toMatch(/^Внести 100\s+сом$/);
    fireEvent.click(button);
    await waitFor(() => expect(onPaid).toHaveBeenCalledWith(100));
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(calls.find(([u]) => u === "/api/sessions/5/payments")![1].body as string).amount).toBe(100);
  });

  it("disables the button when the amount rounds to zero", () => {
    setup(300);
    fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "0.3" } });
    expect(screen.getByRole("button", { name: /^Внести/ })).toBeDisabled();
  });

  it("shows the target name chip", () => {
    setup(300, "Чек №214");
    expect(screen.getByText("Чек №214")).toBeInTheDocument();
  });

  it("fills the amount from the «Всё» and «Половина» chips", () => {
    setup(301);
    const input = screen.getByLabelText("Сумма") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /^Всё/ }));
    expect(input.value).toBe("301");
    fireEvent.click(screen.getByRole("button", { name: "Половина" }));
    expect(input.value).toBe("150");
  });
});

describe("useHallHotkeys edge cases", () => {
  const consoles = [1, 2, 3].map(
    (id): HallConsoleResponse => ({ id, zone_id: 1, name: `PS ${id}`, is_active: true, session: null, charge_total: 0, paid_total: 0, balance: 0 }),
  );

  it("ignores digits while a select or contentEditable element has focus", () => {
    const onOpen = vi.fn();
    renderHook(() => useHallHotkeys(consoles, onOpen, true));
    const select = document.createElement("select");
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    document.body.append(select, editable);
    fireEvent.keyDown(select, { key: "1" });
    fireEvent.keyDown(editable, { key: "1" });
    select.remove();
    editable.remove();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("leaves Enter on a button alone but still opens on a digit from it", () => {
    const onOpen = vi.fn();
    renderHook(() => useHallHotkeys(consoles, onOpen, true));
    const button = document.createElement("button");
    document.body.append(button);
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    button.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    fireEvent.keyDown(button, { key: "3" });
    button.remove();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(consoles[2]);
  });
});
