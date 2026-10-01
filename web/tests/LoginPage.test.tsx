import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "@/features/auth/LoginPage";

function renderLogin() {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ authenticated: false }) })));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LoginPage />
    </QueryClientProvider>,
  );
}

describe("LoginPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps Войти disabled until a password is typed", () => {
    renderLogin();
    expect(screen.getByRole("button", { name: "Войти" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "x" } });
    expect(screen.getByRole("button", { name: "Войти" })).toBeEnabled();
  });

  it("shows and hides the password", () => {
    renderLogin();
    const input = screen.getByLabelText("Пароль");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Показать" }));
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Скрыть" })).toHaveAttribute("aria-pressed", "true");
  });

  it("tells the operator when too many wrong passwords locked the login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/auth/login"
          ? { ok: false, status: 429, json: async () => ({ detail: "too many failed attempts" }) }
          : { ok: true, json: async () => ({ authenticated: false }) },
      ),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LoginPage />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));

    await waitFor(() => expect(screen.getByText(/Слишком много неверных попыток/)).toBeInTheDocument());
  });

  it("warns about Caps Lock", () => {
    renderLogin();
    fireEvent.keyUp(screen.getByLabelText("Пароль"), { key: "A", modifierCapsLock: true });
    expect(screen.getByText("Включён Caps Lock")).toBeInTheDocument();
  });
});
