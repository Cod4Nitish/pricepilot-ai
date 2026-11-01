"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Theme = "dark" | "light";
const ThemeCtx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: "dark", setTheme: () => {} });
export const useTheme = () => useContext(ThemeCtx);

export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: false } },
      }),
  );
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    setThemeState(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    document.documentElement.classList.toggle("dark", t === "dark");
    try {
      localStorage.setItem("pricepilot:theme", t);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <ThemeCtx.Provider value={{ theme, setTheme }}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeCtx.Provider>
  );
}
