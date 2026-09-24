import { LoginPage } from "@/features/auth/LoginPage";
import { useAuth } from "@/features/auth/useAuth";
import { HallPage } from "@/features/hall/HallPage";

function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <div className="p-4">Загрузка…</div>;
  if (!isAuthenticated) return <LoginPage />;

  return <HallPage />;
}

export default App;
