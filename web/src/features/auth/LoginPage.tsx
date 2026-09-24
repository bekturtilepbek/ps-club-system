import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { useAuth } from "./useAuth";

export function LoginPage() {
  const { login, loginError } = useAuth();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await login(password);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <h1 className="text-xl font-semibold">Вход в PS Club</h1>
          <div className="flex flex-col gap-1">
            <Label htmlFor="password">Пароль</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
            />
          </div>
          {loginError && (
            <p className="text-sm text-red-600">
              {loginError instanceof ApiError && loginError.status === 401
                ? "Неверный пароль"
                : "Не удалось войти"}
            </p>
          )}
          <Button type="submit" disabled={submitting || password.length === 0}>
            Войти
          </Button>
        </form>
      </Card>
    </div>
  );
}
