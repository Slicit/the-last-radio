import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { OnAir } from "@/components/on-air";
import { useMe } from "@/hooks/use-auth";
import { useRadios, useStream } from "@/hooks/use-radio";
import { api, type AdminUser, type Radio, type Role } from "@/lib/api";
import { ago, windowLabel } from "@/lib/format";

export function AdminPage() {
  const { user, isLoading } = useMe();
  if (isLoading) return <Skeleton className="h-64" />;
  if (user?.role !== "admin") return <Navigate to="/" replace />;
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
      <RadiosAdmin />
      <UsersAdmin selfId={user.id} />
    </div>
  );
}

// ------------------------------------------------------------------ radios

type RadioForm = {
  slug: string;
  name: string;
  description: string;
  isActive: boolean;
  rateLimitCount: number;
  rateLimitWindowMin: number;
  maxTrackMin: number;
};

const blankForm: RadioForm = {
  slug: "",
  name: "",
  description: "",
  isActive: true,
  rateLimitCount: 3,
  rateLimitWindowMin: 10,
  maxTrackMin: 10,
};

function toForm(r: Radio): RadioForm {
  return {
    slug: r.slug,
    name: r.name,
    description: r.description,
    isActive: r.isActive,
    rateLimitCount: r.rateLimitCount,
    rateLimitWindowMin: Math.round(r.rateLimitWindowSec / 60),
    maxTrackMin: Math.round(r.maxTrackSec / 60),
  };
}

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
  const [editing, setEditing] = useState<Radio | "new" | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Stations</CardTitle>
          <CardDescription>Each active station runs its own stream. Disabling one takes it off the air.</CardDescription>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus /> New station
        </Button>
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
                <TableHead>Push limit</TableHead>
                <TableHead>Max track</TableHead>
                <TableHead>Queue</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {radios?.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link to={`/r/${r.slug}`} className="font-medium hover:underline">
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
                  <TableCell>{r.queueLength}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEditing(r)}>
                      <Pencil />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {radios?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No stations yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <RadioDialog key={editing === "new" ? "new" : (editing?.id ?? "none")} target={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function RadioDialog({ target, onClose }: { target: Radio | "new" | null; onClose: () => void }) {
  const isNew = target === "new";
  const [form, setForm] = useState<RadioForm>(target && target !== "new" ? toForm(target) : blankForm);
  const qc = useQueryClient();
  const set = <K extends keyof RadioForm>(k: K, v: RadioForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        description: form.description,
        isActive: form.isActive,
        rateLimitCount: form.rateLimitCount,
        rateLimitWindowSec: form.rateLimitWindowMin * 60,
        maxTrackSec: form.maxTrackMin * 60,
      };
      return isNew
        ? api.post("/radios", { ...body, slug: form.slug })
        : api.patch(`/radios/${(target as Radio).slug}`, body);
    },
    onSuccess: () => {
      toast.success(isNew ? "Station created" : "Station saved");
      qc.invalidateQueries({ queryKey: ["radios"] });
      qc.invalidateQueries({ queryKey: ["radio"] });
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{isNew ? "New station" : `Edit ${form.name}`}</DialogTitle>
            <DialogDescription>Listeners find it at /r/{form.slug || "…"}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="r-name">Name</Label>
              <Input
                id="r-name"
                required
                value={form.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setForm((f) => ({
                    ...f,
                    name,
                    slug: isNew ? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) : f.slug,
                  }));
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-slug">Slug</Label>
              <Input
                id="r-slug"
                required
                disabled={!isNew}
                pattern="[a-z0-9](?:[a-z0-9\-]{0,38}[a-z0-9])?"
                value={form.slug}
                onChange={(e) => set("slug", e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="r-desc">Description</Label>
            <Input id="r-desc" value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="r-count">Pushes</Label>
              <Input
                id="r-count"
                type="number"
                min={1}
                required
                value={form.rateLimitCount}
                onChange={(e) => set("rateLimitCount", Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-window">per (min)</Label>
              <Input
                id="r-window"
                type="number"
                min={1}
                required
                value={form.rateLimitWindowMin}
                onChange={(e) => set("rateLimitWindowMin", Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-max">Max track (min)</Label>
              <Input
                id="r-max"
                type="number"
                min={1}
                required
                value={form.maxTrackMin}
                onChange={(e) => set("maxTrackMin", Number(e.target.value))}
              />
            </div>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} />
            On the air
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {isNew ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ users

function UsersAdmin({ selfId }: { selfId: string }) {
  const qc = useQueryClient();
  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<{ users: AdminUser[] }>("/users"),
    select: (d) => d.users,
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
        <CardDescription>Admins can manage stations, skip tracks and push without limits.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Pushes</TableHead>
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
      </CardContent>
    </Card>
  );
}
