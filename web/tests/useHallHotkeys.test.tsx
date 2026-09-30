import { fireEvent, render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHallHotkeys } from "@/features/hall/useHallHotkeys";
import type { HallConsoleResponse } from "@/lib/api";

const consoles = [1, 2, 3].map(
  (id): HallConsoleResponse => ({ id, zone_id: 1, name: `PS ${id}`, is_active: true, session: null, charge_total: 0, paid_total: 0, balance: 0 }),
);

describe("useHallHotkeys", () => {
  it("opens the n-th console on a digit key", () => {
    const onOpen = vi.fn();
    renderHook(() => useHallHotkeys(consoles, onOpen, true));
    fireEvent.keyDown(window, { key: "2" });
    expect(onOpen).toHaveBeenCalledWith(consoles[1]);
  });

  it("ignores digits typed into a field, with modifiers, beyond the list, or while a panel is open", () => {
    const onOpen = vi.fn();
    renderHook(() => useHallHotkeys(consoles, onOpen, true));
    const { getByRole, unmount } = render(<input aria-label="Сумма" />);
    fireEvent.keyDown(getByRole("textbox"), { key: "1" });
    fireEvent.keyDown(window, { key: "1", ctrlKey: true });
    fireEvent.keyDown(window, { key: "7" });
    unmount();

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    fireEvent.keyDown(window, { key: "1" });
    dialog.remove();

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("does nothing while disabled", () => {
    const onOpen = vi.fn();
    renderHook(() => useHallHotkeys(consoles, onOpen, false));
    fireEvent.keyDown(window, { key: "1" });
    expect(onOpen).not.toHaveBeenCalled();
  });
});
