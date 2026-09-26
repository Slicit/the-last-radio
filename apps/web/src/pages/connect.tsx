import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, KeyRound, Plug, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyField } from "@/components/copy-field";
import { useMe } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";

type Access = {
  keys: { id: string; name: string; prefix: string; scopes: string[]; createdAt: string; lastUsedAt: string | null }[];
  apps: { clientId: string; name: string; scopes: string[]; connectedAt: string; lastUsedAt: string | null }[];
};

const accessLabel = (scopes: string[]) => (scopes.includes("radio:write") ? "Listen & add songs" : "Read only");

/** Hook an AI assistant (MCP) or a script (API key) up to the listener's account. */
export function ConnectPage() {
  const { user, isLoading } = useMe();
  const mcpUrl = `${window.location.origin}/mcp`;
  // claude.ai reaches connectors from the cloud: it needs a public https address.
  const localOnly = window.location.protocol !== "https:";

  if (isLoading) return <Skeleton className="h-64" />;
  if (!user) return <Navigate to="/login" replace state={{ from: "/connect" }} />;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Connect your AI</h1>
        <p className="text-muted-foreground">
          Ask your assistant what's playing, what's next, or to add a song for you. It acts as you, within your usual
          limits.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-5" /> Your radio in your assistant
          </CardTitle>
          <CardDescription>The Last Radio is an MCP server. Give your assistant this address:</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <CopyField value={mcpUrl} />
          <Tabs defaultValue="claude">
            <TabsList>
              <TabsTrigger value="claude">Claude</TabsTrigger>
              <TabsTrigger value="code">Claude Code</TabsTrigger>
              <TabsTrigger value="other">Other apps</TabsTrigger>
            </TabsList>
            <TabsContent value="claude" className="space-y-3 pt-2 text-sm">
              {localOnly && (
                <Alert>
                  <TriangleAlert />
                  <AlertTitle>This address only works on your network</AlertTitle>
                  <AlertDescription>
                    Claude on the web and in the desktop app connects from the cloud, so it needs the radio on a public
                    https address. Until then, use Claude Code or another app on your network.
                  </AlertDescription>
                </Alert>
              )}
              <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
                <li>
                  In Claude, open <span className="text-foreground">Settings → Connectors</span> and choose{" "}
                  <span className="text-foreground">Add custom connector</span>.
                </li>
                <li>Name it "The Last Radio" and paste the address above.</li>
                <li>Click Connect: you'll land back here to allow it.</li>
                <li>Then just ask: "What's playing on Main Stage?" or "Add some Daft Punk".</li>
              </ol>
            </TabsContent>
            <TabsContent value="code" className="space-y-3 pt-2 text-sm">
              <p className="text-muted-foreground">Add it once, then sign in from Claude Code with /mcp:</p>
              <CopyField value={`claude mcp add --transport http lastradio ${mcpUrl}`} />
              <p className="text-muted-foreground">Or skip the sign-in and use an API key (create one below):</p>
              <CopyField
                value={`claude mcp add --transport http lastradio ${mcpUrl} --header "Authorization: Bearer YOUR_KEY"`}
              />
            </TabsContent>
            <TabsContent value="other" className="space-y-2 pt-2 text-sm text-muted-foreground">
              <p>
                Any MCP client that supports <span className="text-foreground">Streamable HTTP</span> works. Clients
                with OAuth sign in by themselves; otherwise send an API key as{" "}
                <code className="rounded bg-muted px-1 text-foreground">Authorization: Bearer …</code>.
              </p>
              <p>
                The same key works on the REST API, e.g.{" "}
                <code className="rounded bg-muted px-1 text-foreground">GET /api/radios</code>. It's fully described at{" "}
                <a href="/api/openapi.json" className="text-foreground underline">/api/openapi.json</a> (OpenAPI 3.1), and browsable on the{" "}
                <a href="/developers" className="text-foreground underline">Developers</a> page.
              </p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <ApiKeys />
      <ConnectedApps />
    </div>
  );
}

function useAccess() {
  return useQuery({ queryKey: ["access"], queryFn: () => api.get<Access>("/access") });
}

function ApiKeys() {
  const qc = useQueryClient();
  const { data, isLoading } = useAccess();
  const [name, setName] = useState("");
  const [write, setWrite] = useState(true);
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post<{ token: string; key: { name: string } }>("/access/keys", {
        name,
        scopes: write ? ["radio:read", "radio:write"] : ["radio:read"],
      }),
    onSuccess: (d) => {
      setFresh({ name: d.key.name, token: d.token });
      setName("");
      qc.invalidateQueries({ queryKey: ["access"] });
    },
    onError: (e) => toast.error(e.message),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/access/keys/${id}`),
    onSuccess: () => {
      toast.success("Key revoked");
      qc.invalidateQueries({ queryKey: ["access"] });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5" /> API keys
        </CardTitle>
        <CardDescription>For apps without sign-in, scripts and the REST API. Treat a key like a password.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {fresh && (
          <Alert>
            <KeyRound />
            <AlertTitle>Your new key “{fresh.name}”</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>Copy it now: you won't be able to see it again.</p>
              <CopyField value={fresh.token} />
              <Button variant="ghost" size="sm" onClick={() => setFresh(null)}>
                I've saved it
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1 space-y-2">
            <Label htmlFor="key-name">Name</Label>
            <Input
              id="key-name"
              placeholder="e.g. Claude Code on my laptop"
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Access</Label>
            <div className="flex gap-1" role="radiogroup" aria-label="Access">
              {[
                [true, "Listen & add songs"],
                [false, "Read only"],
              ].map(([value, label]) => (
                <Button
                  key={String(value)}
                  type="button"
                  role="radio"
                  aria-checked={write === value}
                  variant={write === value ? "secondary" : "ghost"}
                  onClick={() => setWrite(value as boolean)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <Button type="submit" disabled={create.isPending}>
            Create key
          </Button>
        </form>

        {isLoading ? (
          <Skeleton className="h-16" />
        ) : data?.keys.length ? (
          <ul className="divide-y rounded-lg border">
            {data.keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{k.name}</div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">{k.prefix}…</span> · created {ago(k.createdAt)} ·{" "}
                    {k.lastUsedAt ? `last used ${ago(k.lastUsedAt)}` : "never used"}
                  </div>
                </div>
                <Badge variant="secondary">{accessLabel(k.scopes)}</Badge>
                <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(k.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No keys yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectedApps() {
  const qc = useQueryClient();
  const { data, isLoading } = useAccess();
  const disconnect = useMutation({
    mutationFn: (clientId: string) => api.del(`/access/apps/${clientId}`),
    onSuccess: () => {
      toast.success("Disconnected");
      qc.invalidateQueries({ queryKey: ["access"] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="size-5" /> Connected apps
        </CardTitle>
        <CardDescription>Assistants you've allowed through sign-in.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-16" />
        ) : data?.apps.length ? (
          <ul className="divide-y rounded-lg border">
            {data.apps.map((a) => (
              <li key={a.clientId} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground">
                    connected {ago(a.connectedAt)} · {a.lastUsedAt ? `last used ${ago(a.lastUsedAt)}` : "not used yet"}
                  </div>
                </div>
                <Badge variant="secondary">{accessLabel(a.scopes)}</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate(a.clientId)}
                >
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing connected yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
