import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type Theme, type User } from "@/lib/api";
import { useMe } from "@/hooks/use-auth";

const KEY = "lr_theme";

function applyTheme(theme: Theme) {
  const html = document.documentElement;
  html.classList.toggle("dark", theme === "night");
  if (theme === "night") html.removeAttribute("data-theme");
  else html.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode */
  }
}

function storedTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "pl") return "light"; // renamed
    return saved === "light" || saved === "vintage" ? saved : "night";
  } catch {
    return "night";
  }
}

/**
 * The UI theme. Signed-in people carry it on their account (so it follows them
 * between devices); everyone else keeps it in this browser.
 */
export function useTheme() {
  const { user } = useMe();
  const qc = useQueryClient();
  const [local, setLocal] = useState<Theme>(storedTheme);
  const theme: Theme = user?.theme ?? local;

  useEffect(() => applyTheme(theme), [theme]);

  const setTheme = useCallback(
    async (next: Theme) => {
      setLocal(next);
      applyTheme(next);
      if (user) {
        qc.setQueryData(["me"], { user: { ...user, theme: next } });
        const { user: saved } = await api.patch<{ user: User }>("/me", { theme: next });
        qc.setQueryData(["me"], { user: saved });
      }
    },
    [user, qc],
  );

  return { theme, setTheme };
}
