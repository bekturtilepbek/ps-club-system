import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { bishkekHour } from "@/lib/bishkek";
import { serverNow } from "@/lib/clock";
import { applyTheme, readThemeMode, resolveTheme, saveThemeMode, type ThemeMode } from "@/lib/theme";
import { ThemeModeContext } from "./themeContext";

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readThemeMode);

  useEffect(() => {
    const sync = () => applyTheme(resolveTheme(mode, bishkekHour(serverNow())));
    sync();
    // "auto" flips at 09:00 and 19:00; a minute of lag is fine.
    const timer = setInterval(sync, 60_000);
    return () => clearInterval(timer);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    saveThemeMode(next);
    setModeState(next);
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}
