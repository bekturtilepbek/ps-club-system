import { LoginPage } from "@/features/auth/LoginPage";
import { useAuth } from "@/features/auth/useAuth";
import { HallPage } from "@/features/hall/HallPage";
import { ThemeModeProvider } from "@/features/theme/ThemeModeProvider";

function Screen() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <div className="p-4">Загрузка…</div>;
  if (!isAuthenticated) return <LoginPage />;

  return <HallPage />;
}

function App() {
  return (
    <ThemeModeProvider>
      <Screen />
    </ThemeModeProvider>
  );
}

export default App;
