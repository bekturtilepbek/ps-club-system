import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Suspense, lazy } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "@/components/ErrorBoundary";

describe("ErrorBoundary", () => {
  afterEach(cleanup);

  it("shows a message and a way back when a lazy chunk fails to load", async () => {
    const noise = vi.spyOn(console, "error").mockImplementation(() => {});
    const Broken = lazy(() => Promise.reject(new Error("Failed to fetch dynamically imported module")));
    const onBack = vi.fn();
    render(
      <ErrorBoundary onBack={onBack}>
        <Suspense fallback={<div>Загрузка…</div>}>
          <Broken />
        </Suspense>
      </ErrorBoundary>,
    );
    expect(await screen.findByText("Не удалось загрузить экран. Обновите страницу.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Обновить" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "← Зал" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    noise.mockRestore();
  });
});
