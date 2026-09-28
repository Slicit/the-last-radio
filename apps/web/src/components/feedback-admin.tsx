import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ChevronDown, ChevronUp, Mail, MailOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { KINDS } from "@/components/feedback-dialog";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Pager } from "@/components/pager";

type Item = {
  id: string;
  kind: "idea" | "bug" | "other";
  body: string;
  createdAt: string;
  read: boolean;
  archived: boolean;
  author: { id: string; displayName: string; email: string };
  score: number;
  myVote: number;
};

/** Admin triage: vote a priority, mark read, archive. */
export function FeedbackAdmin() {
  const qc = useQueryClient();
  const [view, setView] = useState<"inbox" | "archived">("inbox");
  const [sort, setSort] = useState<"new" | "top">("new");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const key = ["admin-feedback", view, sort, page, pageSize];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<{ items: Item[]; unread: number; total: number }>(
        `/admin/feedback?view=${view}&sort=${sort}&page=${page}&pageSize=${pageSize}`,
      ),
    placeholderData: keepPreviousData,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-feedback"] });

  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: string; read?: boolean; archived?: boolean }) =>
      api.patch(`/admin/feedback/${id}`, body),
    onSuccess: (_d, v) => {
      if (v.archived !== undefined) toast.success(v.archived ? "Archived" : "Back in the inbox");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const vote = useMutation({
    mutationFn: ({ id, value }: { id: string; value: number }) => api.post(`/admin/feedback/${id}/vote`, { value }),
    onSettled: refresh,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            Messages {!!data?.unread && <Badge>{data.unread} unread</Badge>}
          </CardTitle>
          <CardDescription>What listeners are telling you. Vote to set priorities; archive when handled.</CardDescription>
        </div>
        <div className="flex flex-wrap gap-1">
          {(["inbox", "archived"] as const).map((v) => (
            <Button key={v} size="sm" variant={view === v ? "secondary" : "ghost"} onClick={() => { setView(v); setPage(1); }}>
              {v === "inbox" ? "Inbox" : "Archived"}
            </Button>
          ))}
          <span className="mx-1 w-px self-stretch bg-border" />
          {(["new", "top"] as const).map((s) => (
            <Button key={s} size="sm" variant={sort === s ? "secondary" : "ghost"} onClick={() => setSort(s)}>
              {s === "new" ? "Newest" : "Top voted"}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : !data?.items.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {view === "inbox" ? "Inbox zero. Nothing new from listeners." : "Nothing archived yet."}
          </p>
        ) : (
          <ul className="divide-y">
            {data.items.map((f) => {
              const kind = KINDS.find((k) => k.value === f.kind)!;
              return (
                <li key={f.id} className={cn("flex gap-3 py-3", !f.read && "font-medium")}>
                  <div className="flex w-8 shrink-0 flex-col items-center">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Vote up"
                      aria-pressed={f.myVote === 1}
                      className={cn(f.myVote === 1 && "text-foreground bg-muted")}
                      onClick={() => vote.mutate({ id: f.id, value: f.myVote === 1 ? 0 : 1 })}
                    >
                      <ChevronUp />
                    </Button>
                    <span className="text-sm tabular-nums">{f.score}</span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Vote down"
                      aria-pressed={f.myVote === -1}
                      className={cn(f.myVote === -1 && "text-foreground bg-muted")}
                      onClick={() => vote.mutate({ id: f.id, value: f.myVote === -1 ? 0 : -1 })}
                    >
                      <ChevronDown />
                    </Button>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-normal text-muted-foreground">
                      {!f.read && <span className="size-2 rounded-full bg-brand" aria-label="Unread" />}
                      <Badge variant="outline">
                        <kind.icon /> {kind.label}
                      </Badge>
                      <span>
                        {f.author.displayName} · {f.author.email} · {ago(f.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap break-words">{f.body}</p>
                  </div>
                  <div className="flex shrink-0 items-start gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={f.read ? "Mark as unread" : "Mark as read"}
                      title={f.read ? "Mark as unread" : "Mark as read"}
                      onClick={() => patch.mutate({ id: f.id, read: !f.read })}
                    >
                      {f.read ? <Mail /> : <MailOpen />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={f.archived ? "Restore" : "Archive"}
                      title={f.archived ? "Restore to inbox" : "Archive"}
                      onClick={() => patch.mutate({ id: f.id, archived: !f.archived })}
                    >
                      {f.archived ? <ArchiveRestore /> : <Archive />}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Pager page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} onPageSize={setPageSize} label="messages" />
      </CardContent>
    </Card>
  );
}
