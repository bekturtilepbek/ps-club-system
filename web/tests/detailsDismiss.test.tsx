import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HallHelp } from "@/features/hall/HallHelp";
import { ThemeModeProvider } from "@/features/theme/ThemeModeProvider";
import { ThemeSwitch } from "@/features/theme/ThemeSwitch";

function renderSwitch() {
  render(
    <ThemeModeProvider>
      <ThemeSwitch />
      <button type="button">outside</button>
    </ThemeModeProvider>,
  );
  const summary = screen.getByText((_, el) => el?.tagName === "SUMMARY");
  const details = summary.closest("details") as HTMLDetailsElement;
  return { summary, details };
}

describe("details popovers dismissal", () => {
  afterEach(cleanup);

  it("ThemeSwitch: summary and option group have distinct names", () => {
    renderSwitch();
    expect(screen.getByLabelText("Сменить тему")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Режим темы" })).toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the summary", () => {
    const { summary, details } = renderSwitch();
    details.open = true;
    fireEvent.keyDown(document, { key: "Escape" });
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it("closes on a press outside but stays open on a press inside", () => {
    const { details } = renderSwitch();
    details.open = true;
    fireEvent.pointerDown(screen.getByRole("group", { name: "Режим темы", hidden: true }));
    expect(details.open).toBe(true);
    fireEvent.pointerDown(screen.getByText("outside"));
    expect(details.open).toBe(false);
  });

  it("HallHelp closes on Escape", () => {
    render(<HallHelp />);
    const details = document.querySelector("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent.keyDown(document, { key: "Escape" });
    expect(details.open).toBe(false);
  });
});
