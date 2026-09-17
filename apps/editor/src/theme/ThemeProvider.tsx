import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { readString, writeString } from "../ui/lib/storage.ts";
import type { ThemeName } from "./tokens.ts";

export type ThemePreference = ThemeName | "system";

/** Shared with the pre-paint script in index.html. */
export const THEME_STORAGE_KEY = "sonobe.theme";

export interface ThemeContextValue {
  /** The theme currently applied. */
  theme: ThemeName;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): ThemeName {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function isPreference(value: string | null): value is ThemePreference {
  return value === "dark" || value === "light" || value === "system";
}

export interface ThemeProviderProps {
  children: ReactNode;
  /** Used when nothing is saved. Sonobe is dark-first. */
  defaultPreference?: ThemePreference;
}

/** Applies `data-theme` to <html>, follows the system when asked, and persists the choice. */
export function ThemeProvider({ children, defaultPreference = "dark" }: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    const saved = readString(THEME_STORAGE_KEY);
    return isPreference(saved) ? saved : defaultPreference;
  });
  const [system, setSystem] = useState<ThemeName>(systemTheme);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setSystem(query.matches ? "light" : "dark");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const theme = preference === "system" ? system : preference;

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (root.getAttribute("data-theme") === theme) return;
    root.setAttribute("data-theme-switching", "");
    root.setAttribute("data-theme", theme);
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute("data-theme-switching")));
    return () => cancelAnimationFrame(frame);
  }, [theme]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    writeString(THEME_STORAGE_KEY, next);
  }, []);

  const toggleTheme = useCallback(() => setPreference(theme === "dark" ? "light" : "dark"), [theme, setPreference]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, preference, setPreference, toggleTheme }),
    [theme, preference, setPreference, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
