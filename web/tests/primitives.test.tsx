import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "@/components/ui/segmented";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StateChip } from "@/components/ui/state-chip";

describe("Sheet", () => {
  it("renders a titled side panel with a Russian close button", () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent tone="cross">
          <SheetHeader>
            <SheetTitle>PS 1</SheetTitle>
          </SheetHeader>
          <SheetBody>тело</SheetBody>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.getByRole("dialog", { name: "PS 1" })).toHaveAttribute("data-tone", "cross");
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("SegmentedControl", () => {
  it("marks the current option and reports a new choice", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Способ оплаты"
        value="cash"
        onChange={onChange}
        options={[
          { value: "cash", label: "Наличные" },
          { value: "qr", label: "QR" },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Наличные" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "QR" }));
    expect(onChange).toHaveBeenCalledWith("qr");
  });
});

describe("StateChip", () => {
  it("hides the glyph from screen readers and keeps the label", () => {
    render(
      <StateChip tone="circle" glyph="○" loud>
        Переигрыш
      </StateChip>,
    );
    expect(screen.getByText("Переигрыш").closest("[data-tone]")).toHaveAttribute("data-tone", "circle");
    expect(screen.getByText("○")).toHaveAttribute("aria-hidden", "true");
  });
});
