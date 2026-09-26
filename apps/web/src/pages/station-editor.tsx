import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useBlocker, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Bot, Clock, Lock, ListMusic, Settings2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { StationAccessPanel } from "@/components/station-access";
import { useMe } from "@/hooks/use-auth";
import { api, type Radio, type RadioDetail } from "@/lib/api";
import { cn } from "@/lib/utils";

type StationForm = {
  slug: string;
  name: string;
  description: string;
  isActive: boolean;
  isPrivate: boolean;
  rateLimitCount: number;
  rateLimitWindowMin: number;
  maxTrackMin: number;
  skipVotePercent: number;
  hoursEnabled: boolean;
  hoursDays: number[];
  hoursStart: string;
  hoursEnd: string;
  timezone: string;
  autofillMin: number;
};

const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const timezones: string[] = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [browserTz];
  }
})();
// Monday first, as people read a week.
const WEEK = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [0, "Sun"],
] as const;

const blankForm: StationForm = {
  slug: "",
  name: "",
  description: "",
  isActive: true,
  isPrivate: false,
  rateLimitCount: 3,
  rateLimitWindowMin: 10,
  maxTrackMin: 10,
  skipVotePercent: 50,
  hoursEnabled: false,
  hoursDays: [1, 2, 3, 4, 5],
  hoursStart: "08:00",
  hoursEnd: "18:00",
  timezone: browserTz,
  autofillMin: 15,
};

function toForm(r: Radio): StationForm {
  return {
    slug: r.slug,
    name: r.name,
    description: r.description,
    isActive: r.isActive,
    isPrivate: r.isPrivate,
    rateLimitCount: r.rateLimitCount,
    rateLimitWindowMin: Math.round(r.rateLimitWindowSec / 60),
    maxTrackMin: Math.round(r.maxTrackSec / 60),
    skipVotePercent: r.skipVotePercent,
    hoursEnabled: r.hoursEnabled,
    hoursDays: r.hoursDays,
    hoursStart: r.hoursStart,
    hoursEnd: r.hoursEnd,
    timezone: r.timezone,
    autofillMin: Math.round(r.autofillBelowSec / 60),
  };
}

const SECTIONS = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "rules", label: "Song rules", icon: ListMusic },
  { id: "access", label: "Who can listen", icon: Lock },
  { id: "hours", label: "Broadcast hours", icon: Clock },
  { id: "alfred", label: "Alfred", icon: Bot },
] as const;

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-20">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function NumberField({ id, label, value, min, max, onChange, hint }: { id: string; label: string; value: number; min: number; max?: number; onChange: (n: number) => void; hint?: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" min={min} max={max} required value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Create a station, or edit every setting of one. Admins only. */
export function StationEditorPage() {
  const { slug } = useParams();
  const isNew = !slug;
  const { user, isLoading: meLoading } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const existing = useQuery({
    queryKey: ["radio", slug],
    queryFn: () => api.get<RadioDetail>(`/radios/${slug}`),
    enabled: !isNew,
  });

  const initial = useMemo(() => (isNew ? blankForm : existing.data ? toForm(existing.data.radio) : null), [isNew, existing.data]);
  const [form, setForm] = useState<StationForm | null>(initial);
  // (Re)load the form when the station arrives or we switch stations.
  useEffect(() => setForm(initial), [initial]);
  const set = <K extends keyof StationForm>(k: K, v: StationForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const dirty = !!form && !!initial && JSON.stringify(form) !== JSON.stringify(initial);
  // Set just before our own navigation after a save, which must never be blocked.
  const justSaved = useRef(false);

  // Don't lose edits by navigating away or closing the tab.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && !justSaved.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state === "blocked") {
      if (window.confirm("You have unsaved changes. Leave without saving?")) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => {
      const f = form!;
      const body = {
        name: f.name,
        description: f.description,
        isActive: f.isActive,
        isPrivate: f.isPrivate,
        rateLimitCount: f.rateLimitCount,
        rateLimitWindowSec: f.rateLimitWindowMin * 60,
        maxTrackSec: f.maxTrackMin * 60,
        skipVotePercent: f.skipVotePercent,
        hoursEnabled: f.hoursEnabled,
        hoursDays: f.hoursDays,
        hoursStart: f.hoursStart,
        hoursEnd: f.hoursEnd,
        timezone: f.timezone,
        autofillBelowSec: f.autofillMin * 60,
      };
      return isNew
        ? api.post<{ radio: Radio }>("/radios", { ...body, slug: f.slug })
        : api.patch<{ radio: Radio }>(`/radios/${slug}`, body);
    },
    onSuccess: ({ radio }) => {
      qc.invalidateQueries({ queryKey: ["radios"] });
      qc.setQueryData(["radio", radio.slug], (d: RadioDetail | undefined) => (d ? { ...d, radio: { ...d.radio, ...radio } } : d));
      qc.invalidateQueries({ queryKey: ["radio", radio.slug] });
      justSaved.current = false;
      if (isNew) {
        toast.success("Station created. People, domains and hours can be set here.");
        justSaved.current = true;
        navigate(`/admin/stations/${radio.slug}`, { replace: true });
      } else {
        toast.success("Saved");
      }
    },
    onError: (e) => toast.error(e.message),
  });

  if (meLoading) return <Skeleton className="h-64" />;
  if (user?.role !== "admin") return <Navigate to="/" replace />;
  if (!isNew && existing.isError) {
    return (
      <p className="text-muted-foreground">
        {existing.error.message}.{" "}
        <Link to="/admin" className="text-foreground underline">
          Back to Admin
        </Link>
      </p>
    );
  }
  if (!form) return <Skeleton className="h-96" />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-6 pb-24">
      <div className="space-y-2">
        <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Admin
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{isNew ? "New station" : form.name || "Station"}</h1>
          {!isNew && (
            <Link to={`/r/${slug}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              Open the station <ExternalLink className="size-3.5" />
            </Link>
          )}
        </div>
        <p className="text-sm text-muted-foreground">Listeners find it at /r/{form.slug || "…"}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <nav aria-label="Sections" className="hidden lg:block">
          <ul className="sticky top-20 space-y-1 text-sm">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <a href={`#${id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                  <Icon className="size-4" /> {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          <Section id="general" title="General">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="r-name">Name</Label>
                <Input
                  id="r-name"
                  required
                  value={form.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setForm((f) =>
                      f && {
                        ...f,
                        name,
                        slug: isNew ? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) : f.slug,
                      },
                    );
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="r-slug">Address</Label>
                <Input
                  id="r-slug"
                  required
                  disabled={!isNew}
                  pattern="[a-z0-9](?:[a-z0-9\-]{0,38}[a-z0-9])?"
                  value={form.slug}
                  onChange={(e) => set("slug", e.target.value)}
                />
                {!isNew && <p className="text-xs text-muted-foreground">A station's address can't change once created.</p>}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="r-desc">Description</Label>
              <Input id="r-desc" value={form.description} onChange={(e) => set("description", e.target.value)} />
            </div>
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} />
              {form.isActive ? "On the air" : "Off the air: hidden from listeners, no stream"}
            </label>
          </Section>

          <Section id="rules" title="Song rules" description="What listeners can add, and how the crowd can skip.">
            <div className="grid gap-4 sm:grid-cols-3">
              <NumberField id="r-count" label="Songs per person" min={1} value={form.rateLimitCount} onChange={(n) => set("rateLimitCount", n)} />
              <NumberField id="r-window" label="Every (minutes)" min={1} value={form.rateLimitWindowMin} onChange={(n) => set("rateLimitWindowMin", n)} />
              <NumberField id="r-max" label="Longest song (minutes)" min={1} value={form.maxTrackMin} onChange={(n) => set("maxTrackMin", n)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Each person can add {form.rateLimitCount} {form.rateLimitCount === 1 ? "song" : "songs"} every {form.rateLimitWindowMin} min, up to{" "}
              {form.maxTrackMin} min long. Admins have no limit.
            </p>
            <NumberField
              id="r-skip"
              label="Vote to skip (% of listeners)"
              min={0}
              max={100}
              value={form.skipVotePercent}
              onChange={(n) => set("skipVotePercent", n)}
              hint={
                form.skipVotePercent > 0
                  ? `A song is skipped when ${form.skipVotePercent}% of the people listening vote against it. Set 0 to turn votes off.`
                  : "Votes are off. Only admins and the person who added a song can skip it."
              }
            />
          </Section>

          <Section id="access" title="Who can listen">
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={form.isPrivate} onCheckedChange={(v) => set("isPrivate", v)} />
              {form.isPrivate ? "Private: only the people and email domains below" : "Public: everyone"}
            </label>
            {form.isPrivate &&
              (isNew ? (
                <p className="text-xs text-muted-foreground">Create the station, then add people and email domains here.</p>
              ) : (
                <StationAccessPanel slug={form.slug} />
              ))}
            {!isNew && form.isPrivate !== initial?.isPrivate && (
              <p className="text-xs text-muted-foreground">Save to make the station {form.isPrivate ? "private" : "public"}.</p>
            )}
          </Section>

          <Section id="hours" title="Broadcast hours" description="In the station's own timezone.">
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={form.hoursEnabled} onCheckedChange={(v) => set("hoursEnabled", v)} />
              {form.hoursEnabled ? "Only on air during these hours" : "On air around the clock"}
            </label>
            {form.hoursEnabled && (
              <>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
                  {WEEK.map(([d, label]) => {
                    const on = form.hoursDays.includes(d);
                    return (
                      <Button
                        key={d}
                        type="button"
                        size="sm"
                        variant={on ? "default" : "outline"}
                        aria-pressed={on}
                        className="w-12"
                        onClick={() => set("hoursDays", on ? form.hoursDays.filter((x) => x !== d) : [...form.hoursDays, d])}
                      >
                        {label}
                      </Button>
                    );
                  })}
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="r-start">Opens at</Label>
                    <Input id="r-start" type="time" required value={form.hoursStart} onChange={(e) => set("hoursStart", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="r-end">Closes at</Label>
                    <Input id="r-end" type="time" required value={form.hoursEnd} onChange={(e) => set("hoursEnd", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="r-tz">Timezone</Label>
                    <Input id="r-tz" list="r-tz-list" required value={form.timezone} onChange={(e) => set("timezone", e.target.value)} />
                    <datalist id="r-tz-list">
                      {timezones.map((tz) => (
                        <option key={tz} value={tz} />
                      ))}
                    </datalist>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {form.hoursEnd <= form.hoursStart && form.hoursEnd !== form.hoursStart
                    ? `Runs past midnight: each night ends at ${form.hoursEnd} the next morning. `
                    : ""}
                  A song still playing at closing time finishes. The queue waits for the next opening.
                </p>
              </>
            )}
          </Section>

          <Section id="alfred" title="Alfred, the fill-in DJ" description="Keeps the station from going quiet.">
            <NumberField
              id="r-alfred"
              label="Top up the queue when less than (minutes) is lined up"
              min={0}
              value={form.autofillMin}
              onChange={(n) => set("autofillMin", n)}
              hint={
                form.autofillMin > 0
                  ? "Alfred replays songs this station liked before (never ones that were voted off). Songs people add always play first. Set 0 to turn him off."
                  : "Alfred is off: when the queue runs out, the station goes quiet."
              }
            />
          </Section>
        </div>
      </div>

      {/* Appears only when there's something to save. */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur transition-transform",
          dirty || isNew ? "translate-y-0" : "translate-y-full",
        )}
        aria-hidden={!(dirty || isNew)}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-end gap-2 px-4 py-3">
          {dirty && !isNew && <span className="mr-auto text-sm text-muted-foreground">Unsaved changes</span>}
          <Button type="button" variant="outline" onClick={() => (isNew ? navigate("/admin") : setForm(initial))}>
            {isNew ? "Cancel" : "Discard"}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {isNew ? "Create station" : "Save changes"}
          </Button>
        </div>
      </div>
    </form>
  );
}
