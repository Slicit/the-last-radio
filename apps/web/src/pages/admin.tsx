import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BarChart3, FileUp, Lock, MessageSquare, Pencil, Plus, Radio as RadioIcon, Search, Settings, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { OnAir } from "@/components/on-air";
import { Pager } from "@/components/pager";
import { FeedbackAdmin } from "@/components/feedback-admin";
import { StationImportDialog } from "@/components/station-import-dialog";
import { ListenerStatsAdmin } from "@/components/listener-stats";
import { SiteSettingsAdmin } from "@/components/site-settings-admin";
import { useSiteSettings } from "@/hooks/use-theme";
import { useMe } from "@/hooks/use-auth";
import { useRadios, useStream } from "@/hooks/use-radio";
import { api, type AdminUser, type Role } from "@/lib/api";
import { ago, hoursSummary, windowLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------ layout

/** Unread feedback, for the menu badge (shares the inbox's cache key, so it refreshes with it). */
function useUnreadFeedback() {
  const { data } = useQuery({
    queryKey: ["admin-feedback", "unread"],
    queryFn: () => api.get<{ unread: number }>("/admin/feedback?view=inbox&pageSize=1"),
    refetchInterval: 60_000,
  });
  return data?.unread ?? 0;
}

const SECTIONS = [
  { to: "/admin", label: "Overview", icon: BarChart3, end: true },
  { to: "/admin/feedback", label: "Feedback", icon: MessageSquare },
  { to: "/admin/stations", label: "Stations", icon: RadioIcon },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/settings", label: "Settings", icon: Settings },
] as const;

/**
 * Admin: a menu on the left (a row of tabs on phones) and one page per area.
 * The station editor opens inside it too.
 */
export function AdminLayout() {
  const { user, isLoading } = useMe();
  const unread = useUnreadFeedback();
  if (isLoading) return <Skeleton className="h-64" />;
  if (user?.role !== "admin") return <Navigate to="/" replace />;
  return (
    <div className="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)]">
      <nav aria-label="Admin" className="lg:sticky lg:top-20 lg:self-start">
        <div className="mb-2 hidden px-2 text-xs font-medium tracking-widest text-muted-foreground uppercase lg:block">Admin</div>
        <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
          {SECTIONS.map(({ to, label, icon: Icon, ...rest }) => (
            <li key={to} className="shrink-0">
              <NavLink
                to={to}
                end={"end" in rest}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors",
                    isActive ? "bg-secondary font-medium text-secondary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )
                }
              >
                <Icon className="size-4" /> {label}
                {label === "Feedback" && unread > 0 && (
                  <Badge className="ml-auto h-4.5 px-1.5 text-[0.65rem]" aria-label={`${unread} unread`}>
                    {unread}
                  </Badge>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}

function PageTitle({ children, description }: { children: ReactNode; description?: ReactNode }) {
  return (
    <div className="mb-6 space-y-1">
      <h1 className="text-2xl font-bold tracking-tight">{children}</h1>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

export function AdminOverviewPage() {
  return (
    <>
      <PageTitle description="How many people listen, on every station.">Overview</PageTitle>
      <ListenerStatsAdmin />
    </>
  );
}

export function AdminFeedbackPage() {
  return (
    <>
      <PageTitle description="Ideas and bugs people sent: vote a priority, mark read, archive.">Feedback</PageTitle>
      <FeedbackAdmin />
    </>
  );
}

export function AdminStationsPage() {
  return (
    <>
      <PageTitle description="Each active station runs its own stream. Open one to edit its rules, who can listen and its hours.">Stations</PageTitle>
      <RadiosAdmin />
    </>
  );
}

export function AdminUsersPage() {
  const { user } = useMe();
  return (
    <>
      <PageTitle description="Admins manage stations, skip songs and add without limits.">Users</PageTitle>
      <UsersAdmin selfId={user!.id} />
    </>
  );
}

export function AdminSettingsPage() {
  return (
    <>
      <PageTitle description="Radio-wide settings. Changes here apply as soon as you pick them.">Settings</PageTitle>
      <SiteSettingsAdmin />
    </>
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
  const transfer = useSiteSettings().data?.stationTransfer;
  const [importing, setImporting] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>All stations</CardTitle>
          <CardDescription>Turning one off in its settings takes it off the air.</CardDescription>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {transfer && (
            <Button variant="outline" onClick={() => setImporting(true)}>
              <FileUp /> Import
            </Button>
          )}
          <Link to="/admin/stations/new" className={buttonVariants()}>
            <Plus /> New station
          </Link>
        </div>
        {transfer && <StationImportDialog open={importing} onOpenChange={setImporting} />}
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

type UserFilter = "all" | "admins" | "unconfirmed" | "former";
const USER_FILTERS: { value: UserFilter; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "admins", label: "Admins" },
  { value: "unconfirmed", label: "Not confirmed" },
  { value: "former", label: "Former" },
];

function UsersAdmin({ selfId }: { selfId: string }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filter, setFilter] = useState<UserFilter>("all");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);
  const { data, isLoading } = useQuery({
    queryKey: ["users", page, pageSize, filter, q],
    queryFn: () =>
      api.get<{ items: AdminUser[]; total: number }>(
        `/users?${new URLSearchParams({ page: String(page), pageSize: String(pageSize), filter, ...(q ? { q } : {}) })}`,
      ),
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
  const setCounted = useMutation({
    mutationFn: ({ id, counted }: { id: string; counted: boolean }) => api.patch(`/users/${id}`, { excludeFromStats: !counted }),
    onSuccess: (_, { counted }) => {
      toast.success(counted ? "Counted in stats again" : "Left out of stats: top players, song records and listener charts");
      qc.invalidateQueries({ queryKey: ["users"] });
      // Their past activity changes the numbers everywhere (station stats, song records).
      qc.invalidateQueries({ queryKey: ["radio"] });
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
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Search people"
              placeholder="Search by name or email"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-1 overflow-x-auto" role="radiogroup" aria-label="Show">
            {USER_FILTERS.map((f) => (
              <Button
                key={f.value}
                size="sm"
                className="shrink-0"
                role="radio"
                aria-checked={filter === f.value}
                variant={filter === f.value ? "secondary" : "ghost"}
                onClick={() => {
                  setFilter(f.value);
                  setPage(1);
                }}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </div>
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
                <TableHead>
                  <span title="Off: left out of top players, song records (adds, votes, upvotes) and listener charts. For test accounts or admins trying things.">
                    In stats
                  </span>
                </TableHead>
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
                  <TableCell>
                    <Switch
                      checked={!u.excludeFromStats}
                      disabled={setCounted.isPending}
                      aria-label={`Count ${u.displayName} in stats`}
                      onCheckedChange={(counted) => setCounted.mutate({ id: u.id, counted })}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{u.pushes}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.plays}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">{ago(u.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!isLoading && data?.total === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">{q ? `Nobody matches “${q}”.` : "Nobody here."}</p>
        )}
        <Pager always page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} onPageSize={setPageSize} label="people" />
      </CardContent>
    </Card>
  );
}
