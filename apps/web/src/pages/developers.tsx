import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FileJson } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyField } from "@/components/copy-field";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Operation = {
  summary: string;
  description?: string;
  tags: string[];
  parameters: { name: string; in: string; required: boolean; description?: string; schema: Record<string, unknown> }[];
  requestBody?: { content: Record<string, { schema: unknown }> };
};
type Doc = { info: { description: string }; tags: { name: string }[]; paths: Record<string, Record<string, Operation>> };

const METHOD_STYLE: Record<string, string> = {
  get: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  post: "bg-brand/15 text-brand",
  put: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  patch: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  delete: "bg-destructive/15 text-destructive",
};

/** The REST API, rendered from /api/openapi.json. */
export function DevelopersPage() {
  const { data, isLoading } = useQuery({ queryKey: ["openapi"], queryFn: () => api.get<Doc>("/openapi.json") });
  const [open, setOpen] = useState<string | null>(null);
  const specUrl = `${window.location.origin}/api/openapi.json`;

  const byTag = new Map<string, { method: string; path: string; op: Operation }[]>();
  for (const [path, methods] of Object.entries(data?.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      const tag = op.tags[0];
      byTag.set(tag, [...(byTag.get(tag) ?? []), { method, path, op }]);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Developers</h1>
        <p className="text-muted-foreground">
          Everything the website does is available as a REST API. AI assistants can use the MCP server instead (see{" "}
          <Link to="/connect" className="text-foreground underline">
            Connect your AI
          </Link>
          ). Authenticate with an API key or an OAuth token: <code className="rounded bg-muted px-1">Authorization: Bearer …</code>.
        </p>
        <div className="flex items-center gap-2 text-sm">
          <FileJson className="size-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0">OpenAPI 3.1:</span>
          <CopyField value={specUrl} className="flex-1" />
        </div>
      </div>

      {isLoading && <Skeleton className="h-64" />}
      {[...byTag.entries()].map(([tag, ops]) => (
        <section key={tag} className="space-y-2">
          <h2 className="text-lg font-semibold">{tag}</h2>
          <Card>
            <CardContent className="divide-y p-0">
              {ops.map(({ method, path, op }) => {
                const id = `${method} ${path}`;
                const expanded = open === id;
                return (
                  <div key={id}>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : id)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50"
                    >
                      <span className={cn("w-16 shrink-0 rounded px-1.5 py-0.5 text-center font-mono text-xs font-semibold uppercase", METHOD_STYLE[method])}>
                        {method}
                      </span>
                      <code className="min-w-0 shrink truncate text-sm">{path}</code>
                      <span className="ml-auto hidden truncate text-sm text-muted-foreground sm:block">{op.summary}</span>
                      <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
                    </button>
                    {expanded && (
                      <div className="space-y-3 px-4 pb-4 text-sm">
                        <p className="font-medium sm:hidden">{op.summary}</p>
                        {op.description && <p className="whitespace-pre-line text-muted-foreground">{op.description}</p>}
                        {!!op.parameters.length && (
                          <div className="space-y-1">
                            <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Parameters</div>
                            <ul className="space-y-0.5">
                              {op.parameters.map((p) => (
                                <li key={p.in + p.name}>
                                  <code>{p.name}</code> <Badge variant="outline">{p.in}</Badge>
                                  {p.required && <span className="text-destructive"> required</span>}
                                  {p.description && <span className="text-muted-foreground"> · {p.description}</span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {op.requestBody &&
                          Object.entries(op.requestBody.content).map(([type, { schema }]) => (
                            <div key={type} className="space-y-1">
                              <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Body · {type}</div>
                              <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(schema, null, 2)}</pre>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </section>
      ))}
    </div>
  );
}
