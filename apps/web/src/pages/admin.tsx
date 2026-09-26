import { useState } from "react";
import { Link, Navigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, Pencil, Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { OnAir } from "@/components/on-air";
import { Pager } from "@/components/pager";
import { FeedbackAdmin } from "@/components/feedback-admin";
import { useMe } from "@/hooks/use-auth";
import { useRadios, useStream } from "@/hooks/use-radio";
import { api, type AdminUser, type Role } from "@/lib/api";
import { ago, hoursSummary, windowLabel } from "@/lib/format";

export function AdminPage() {
  const { user, isLoading } = useMe();
  if (isLoading) return <Skeleton className="h-64" />;
  if (user?.role !== "admin") return <Navigate to="/" replace />;
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
      <FeedbackAdmin />
      <RadiosAdmin />
      <UsersAdmin selfId={user.id} />
    </div>
  );
}

// ------------------------------------------------------------------ radios

function StreamCell({ slug, active }: { slug: string; active: boolean }) {
  const { data } = useStream(active ? slug : undefined);
  if (!active) return <span className="text-xs text-muted-foreground">stopped</span>;
  return (
    <div className="flex items-center gap-2">
      <OnAir live={!!data?.live} />
      {data?.live && data.readySince && (
        <span className="text-xs text-muted-foreground">since {ago(data.readySince)}</span>
      )}
    </div>
  );
}

function RadiosAdmin() {
  const { data: radios, isLoading } = useRadios();

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Stations</CardTitle>
          <CardDescription>Each active station runs its own stream. Disabling one takes it off the air.</CardDescription>
        </div>
        <Link to="/admin/stations/new" className={buttonVariants()}>
          <Plus /> New station
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Station</TableHead>
                <TableHead>Stream</TableHead>
                <TableHead>Song limit</TableHead>
                <TableHead>Max track</TableHead>
                <TableHead>Skip vote</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Queue</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {radios?.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link to={`/r/${r.slug}`} className="inline-flex items-center gap-1 font-medium hover:underline">
                      {r.isPrivate && <Lock className="size-3.5" aria-label="Private" />}
                      {r.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">/{r.slug}</div>
                  </TableCell>
                  <TableCell>
                    <StreamCell slug={r.slug} active={r.isActive} />
                  </TableCell>
                  <TableCell>
                    {r.rateLimitCount} / {windowLabel(r.rateLimitWindowSec)}
                  </TableCell>
                  <TableCell>{windowLabel(r.maxTrackSec)}</TableCell>
                  <TableCell>{r.skipVotePercent > 0 ? `${r.skipVotePercent}%` : "off"}</TableCell>
                  <TableCell className="max-w-44 text-xs whitespace-normal text-muted-foreground">
                    {r.hoursEnabled ? hoursSummary(r) : "Always"}
                  </TableCell>
                  <TableCell>{r.queueLength}</TableCell>
                  <TableCell className="text-right">
                    <Link to={`/admin/stations/${r.slug}`} aria-label={`Edit ${r.name}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
                      <Pencil />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {radios?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    No stations yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ users

function UsersAdmin({ selfId }: { selfId: string }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { data, isLoading } = useQuery({
    queryKey: ["users", page, pageSize],
    queryFn: () => api.get<{ items: AdminUser[]; total: number }>(`/users?page=${page}&pageSize=${pageSize}`),
    placeholderData: (prev) => prev,
  });
  const users = data?.items;
  const verify = useMutation({
    mutationFn: (id: string) => api.patch(`/users/${id}`, { emailVerified: true }),
    onSuccess: () => {
      toast.success("Marked as verified");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast.error(e.message),
  });
  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => api.patch(`/users/${id}`, { role }),
    onSuccess: () => {
      toast.success("Role updated");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>Admins can manage stations, skip songs and add without limits.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Added</TableHead>
                <TableHead className="text-right">Aired</TableHead>
                <TableHead className="text-right">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users?.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{u.displayName}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell>
                    {u.emailVerified ? (
                      <span className="text-xs text-brand">confirmed</span>
                    ) : (
                      <Button variant="ghost" size="xs" onClick={() => verify.mutate(u.id)} title="Vouch for this address (when email can't be sent)">
                        Mark verified
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={u.role}
                      disabled={u.id === selfId || setRole.isPending}
                      onValueChange={(role) => role && setRole.mutate({ id: u.id, role: role as Role })}
                    >
                      <SelectTrigger size="sm" className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="player">player</SelectItem>
                        <SelectItem value="admin">admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{u.pushes}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.plays}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">{ago(u.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pager page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} onPageSize={setPageSize} label="people" />
      </CardContent>
    </Card>
  );
}
