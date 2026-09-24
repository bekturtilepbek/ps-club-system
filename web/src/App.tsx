import { LoginPage } from "@/features/auth/LoginPage";
import { useAuth } from "@/features/auth/useAuth";

function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <div className="p-4">Загрузка…</div>;
  if (!isAuthenticated) return <LoginPage />;

  return <div data-testid="hall-page">Зал (наполнение — Задача 15)</div>;
}

export default App;
