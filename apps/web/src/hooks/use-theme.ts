import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

export type SiteSettings = { defaultTheme: Theme };

/** Radio-wide settings anyone can read (the default theme). */
export const useSiteSettings = () =>
  useQuery({ queryKey: ["settings"], queryFn: () => api.get<SiteSettings>("/settings"), staleTime: 5 * 60_000 });

/**
 * The UI theme. Signed-in people carry theirs on their account (so it follows
 * them between devices); guests see the radio's default, chosen by the admins.
 * The theme last shown is kept in this browser so the next visit paints it at once.
 */
export function useTheme() {
  const { user } = useMe();
  const qc = useQueryClient();
  const site = useSiteSettings();
  const [local, setLocal] = useState<Theme>(storedTheme);
  const theme: Theme = user?.theme ?? site.data?.defaultTheme ?? local;

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
