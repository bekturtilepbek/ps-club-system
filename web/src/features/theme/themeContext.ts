import { createContext, useContext } from "react";
import type { ThemeMode } from "@/lib/theme";

export interface ThemeModeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

export function useThemeMode(): ThemeModeContextValue {
  const context = useContext(ThemeModeContext);
  if (!context) throw new Error("useThemeMode must be used inside <ThemeModeProvider>");
  return context;
}
