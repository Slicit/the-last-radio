import { useState } from "react";
import { Navigate, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot, ListMusic, Radio, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useMe } from "@/hooks/use-auth";
import { api } from "@/lib/api";

type Info = {
  client: { id: string; name: string; redirectHost: string };
  scopes: { scope: string; description: string }[];
};

const SCOPE_ICON: Record<string, typeof Radio> = { "radio:read": Radio, "radio:write": ListMusic };

/** OAuth consent screen: an AI app (via MCP) asks to act as this listener. */
export function OAuthAuthorizePage() {
  const { user, isLoading } = useMe();
  const location = useLocation();
  const params = Object.fromEntries(new URLSearchParams(location.search));
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const info = useQuery({
    queryKey: ["oauth-authorize", location.search],
    queryFn: () => api.get<Info>(`/oauth/authorize${location.search}`),
    enabled: !!user,
    retry: false,
  });

  if (isLoading) return <Skeleton className="mx-auto h-72 max-w-md rounded-xl" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;

  const decide = async (approve: boolean) => {
    setBusy(approve ? "allow" : "deny");
    setError(null);
    try {
      const { redirectTo } = await api.post<{ redirectTo: string }>("/oauth/authorize", { ...params, approve });
      window.location.assign(redirectTo);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-md pt-6">
      <Card>
        {info.isLoading ? (
          <CardContent>
            <Skeleton className="h-56" />
          </CardContent>
        ) : info.isError ? (
          <CardContent className="space-y-3 py-6">
            <Alert variant="destructive">
              <AlertTitle>This connection link doesn't work</AlertTitle>
              <AlertDescription>{info.error.message}. Go back to your app and try connecting again.</AlertDescription>
            </Alert>
          </CardContent>
        ) : (
          <>
            <CardHeader className="items-center text-center">
              <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-muted">
                <Bot className="size-6" />
              </div>
              <CardTitle className="text-xl">{info.data!.client.name} wants to connect</CardTitle>
              <CardDescription>
                It will act as <span className="font-medium text-foreground">{user.displayName}</span> ({user.email}) on
                The Last Radio.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <div className="text-sm font-medium">It will be able to:</div>
                <ul className="space-y-2">
                  {info.data!.scopes.map((s) => {
                    const Icon = SCOPE_ICON[s.scope] ?? ShieldCheck;
                    return (
                      <li key={s.scope} className="flex items-start gap-2.5 text-sm">
                        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        {s.description}
                      </li>
                    );
                  })}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Songs it adds count toward your own limit. It can't change your account or any admin settings. You
                  can disconnect it anytime from <span className="text-foreground">Connect your AI</span>.
                </p>
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="lg" disabled={!!busy} onClick={() => decide(false)}>
                  {busy === "deny" ? "…" : "Deny"}
                </Button>
                <Button size="lg" disabled={!!busy} onClick={() => decide(true)}>
                  {busy === "allow" ? "Connecting…" : "Allow"}
                </Button>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                You'll be sent back to <span className="font-mono">{info.data!.client.redirectHost}</span>
              </p>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
