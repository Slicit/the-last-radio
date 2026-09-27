import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSiteSettings, type SiteSettings } from "@/hooks/use-theme";
import { api, type Theme } from "@/lib/api";
import { cn } from "@/lib/utils";

// A tiny swatch of each theme: background, card, brand.
const THEMES: { value: Theme; label: string; colors: [string, string, string] }[] = [
  { value: "night", label: "Night", colors: ["#0a0a0a", "#262626", "#fb2c36"] },
  { value: "light", label: "Light", colors: ["#f3eee9", "#ffffff", "#00a04a"] },
  { value: "vintage", label: "Vintage", colors: ["#efe3cb", "#f8efdd", "#c2610c"] },
];

/** Admin: radio-wide settings. For now, the theme guests and new accounts get. */
export function SiteSettingsAdmin() {
  const qc = useQueryClient();
  const { data, isLoading } = useSiteSettings();
  const save = useMutation({
    mutationFn: (patch: Partial<SiteSettings>) => api.patch<SiteSettings>("/admin/settings", patch),
    onSuccess: (saved) => {
      qc.setQueryData(["settings"], saved);
      toast.success(`Default theme: ${THEMES.find((t) => t.value === saved.defaultTheme)?.label}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Default theme</CardTitle>
        <CardDescription>
          What guests see, and what new accounts start with. People who picked a theme keep theirs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-20" />
        ) : (
          <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Default theme">
            {THEMES.map((t) => {
              const on = data.defaultTheme === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={save.isPending}
                  onClick={() => !on && save.mutate({ defaultTheme: t.value })}
                  className={cn(
                    "flex w-36 flex-col gap-2 rounded-lg border p-2 text-left text-sm transition-colors hover:bg-muted/50",
                    on && "border-foreground ring-1 ring-foreground",
                  )}
                >
                  <span className="flex h-12 overflow-hidden rounded-md border" style={{ background: t.colors[0] }} aria-hidden>
                    <span className="m-1.5 flex-1 rounded-sm" style={{ background: t.colors[1] }} />
                    <span className="my-3 mr-2 w-4 rounded-full" style={{ background: t.colors[2] }} />
                  </span>
                  <span className="flex items-center justify-between font-medium">
                    {t.label}
                    {on && <Check className="size-4" />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
