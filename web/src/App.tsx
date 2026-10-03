import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LoginPage } from "@/features/auth/LoginPage";
import { AUTH_QUERY_KEY, useAuth } from "@/features/auth/useAuth";
import { HallPage } from "@/features/hall/HallPage";
import { ThemeModeProvider } from "@/features/theme/ThemeModeProvider";
import { setUnauthorizedHandler } from "@/lib/api";

function Screen() {
  const { isAuthenticated, isLoading } = useAuth();
  const queryClient = useQueryClient();

  // The login cookie can stop being valid while the till stays open (the secret was changed, the
  // cookie was cleared). Any 401 from the server then sends the operator back to the login form
  // instead of leaving a hall screen that looks alive but fails every action.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      // A check of the login that was already on its way would come back "signed in" and undo this.
      void queryClient.cancelQueries({ queryKey: AUTH_QUERY_KEY });
      queryClient.setQueryData(AUTH_QUERY_KEY, { authenticated: false });
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

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
