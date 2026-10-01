import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { useAuth } from "./useAuth";

export function LoginPage() {
  const { login, loginError } = useAuth();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await login(password);
    } catch {
      // error already surfaces via loginError
    } finally {
      setSubmitting(false);
    }
  }

  const trackCapsLock = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState("CapsLock"));

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <form onSubmit={handleSubmit} className="gate-card">
        {/* The six consoles, asleep; they light up one by one while signing in. */}
        <div aria-hidden className="sleepers" data-waking={submitting}>
          <i /><i /><i /><i /><i /><i />
        </div>
        <div>
          <h1 className="font-display text-[34px] font-extrabold tracking-tight">
            PS<span className="font-medium text-fg-muted">·клуб</span>
          </h1>
          <p className="text-sm text-fg-muted">Касса клуба. Один пароль на весь клуб.</p>
        </div>
        <div>
          <label htmlFor="password" className="field-label">
            Пароль
          </label>
          <div className="relative">
            <Input
              id="password"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              className="num h-12 pr-[104px] text-xl"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyUp={trackCapsLock}
              onKeyDown={trackCapsLock}
              autoFocus
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-1.5 top-1"
              aria-pressed={visible}
              onClick={() => setVisible((value) => !value)}
            >
              {visible ? "Скрыть" : "Показать"}
            </Button>
          </div>
          {capsLock && <p className="mt-2 text-[13.5px] text-status-amber-text">Включён Caps Lock</p>}
          {loginError && (
            <p role="alert" className="mt-2 text-[13.5px] text-status-circle">
              {loginError instanceof ApiError && loginError.status === 401
                ? "Неверный пароль"
                : loginError instanceof ApiError && loginError.status === 429
                  ? "Слишком много неверных попыток. Подождите 15 минут."
                  : "Не удалось войти"}
            </p>
          )}
        </div>
        <Button type="submit" size="lg" disabled={submitting || password.length === 0}>
          Войти
        </Button>
      </form>
    </div>
  );
}
