import type { ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Headphones, Loader2, Pause, Play, SkipForward, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { TrackArt } from "@/components/track-art";
import { SongSearch } from "@/components/song-search";
import { OnAir } from "@/components/on-air";
import { useMe } from "@/hooks/use-auth";
import { usePlayer } from "@/hooks/use-player";
import { useElapsed, useHistory, useNow, useRadio, useStats, useStream } from "@/hooks/use-radio";
import { api, type QueueItem, type Quota, type User } from "@/lib/api";
import { ago, duration, hours, windowLabel } from "@/lib/format";

export function RadioPage() {
  const { slug } = useParams();
  const { data, isLoading, error } = useRadio(slug);
  const { data: stream } = useStream(slug);
  const { user } = useMe();

  if (isLoading) return <Skeleton className="h-64 rounded-xl" />;
  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          {error?.message ?? "Station not found."}{" "}
          <Link to="/" className="text-foreground underline">
            Back to stations
          </Link>
        </CardContent>
      </Card>
    );
  }

  const { radio } = data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{radio.name}</h1>
            <OnAir live={!!stream?.live} />
            {!radio.isActive && <Badge variant="outline">disabled</Badge>}
          </div>
          {radio.description && <p className="text-muted-foreground">{radio.description}</p>}
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Headphones className="size-4" /> {stream?.listeners ?? 0} listening
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <NowPlaying
          slug={radio.slug}
          name={radio.name}
          item={data.nowPlaying}
          clockSkewMs={data.clockSkewMs}
          isAdmin={user?.role === "admin"}
        />
        <AddSongCard
          slug={radio.slug}
          user={user}
          quota={data.quota}
          maxTrackSec={radio.maxTrackSec}
          queue={data.queue}
          nowPlaying={data.nowPlaying}
        />
      </div>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Up next ({data.queue.length})</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="tracks">Top tracks</TabsTrigger>
          <TabsTrigger value="players">Top players</TabsTrigger>
        </TabsList>
        <TabsContent value="queue">
          <QueueList slug={radio.slug} items={data.queue} user={user} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryList slug={radio.slug} />
        </TabsContent>
        <TabsContent value="tracks">
          <TopTracks slug={radio.slug} />
        </TabsContent>
        <TabsContent value="players">
          <TopPlayers slug={radio.slug} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ------------------------------------------------------------------ now playing

function NowPlaying({
  slug,
  name,
  item,
  clockSkewMs,
  isAdmin,
}: {
  slug: string;
  name: string;
  item: QueueItem | null;
  clockSkewMs: number;
  isAdmin: boolean;
}) {
  const player = usePlayer();
  const qc = useQueryClient();
  const tunedHere = player.station?.slug === slug;
  const listening = tunedHere && (player.status === "playing" || player.status === "connecting");
  const elapsed = useElapsed(item?.startedAt, clockSkewMs, listening ? player.latency : 0);
  const total = item?.track.durationSec ?? null;

  const skip = useMutation({
    mutationFn: () => api.post<{ skipped: boolean }>(`/radios/${slug}/skip`),
    onSuccess: () => {
      toast.success("Skipped");
      qc.invalidateQueries({ queryKey: ["radio", slug] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 sm:flex-row">
        <TrackArt src={item?.track.thumbnailUrl} className="aspect-square w-full sm:w-48" />
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs font-medium tracking-widest text-muted-foreground uppercase">Now playing</div>
            <div className="text-2xl leading-tight font-semibold break-words">
              {item?.track.title ?? "Dead air"}
            </div>
            <div className="text-muted-foreground">
              {item ? (
                <>
                  {item.track.artist && <>{item.track.artist} · </>}
                  added by <span className="text-foreground">{item.pushedBy.displayName}</span>
                </>
              ) : (
                "The playlist is empty. Add a song!"
              )}
            </div>
          </div>
          {item && (
            <div className="space-y-1.5">
              <Progress value={total ? Math.min(100, (elapsed / total) * 100) : null} />
              <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{duration(total ? Math.min(elapsed, total) : elapsed)}</span>
                <span>{duration(total)}</span>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="lg"
              className="rounded-full px-5"
              onClick={() => (listening ? player.stop() : player.tune({ slug, name }))}
            >
              {tunedHere && player.status === "connecting" ? (
                <Loader2 className="animate-spin" />
              ) : listening ? (
                <Pause />
              ) : (
                <Play />
              )}
              {listening ? "Stop" : "Listen live"}
            </Button>
            {item && (
              <a
                href={item.track.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "ghost", size: "lg" })}
              >
                <ExternalLink /> Source
              </a>
            )}
            {isAdmin && item && (
              <Button variant="outline" size="lg" disabled={skip.isPending} onClick={() => skip.mutate()}>
                <SkipForward /> Skip
              </Button>
            )}
          </div>
          {tunedHere && player.status === "offline" && (
            <p className="text-sm text-muted-foreground">The stream isn't up yet. Retrying automatically…</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ add a song

function AddSongCard({
  slug,
  user,
  quota,
  maxTrackSec,
  queue,
  nowPlaying,
}: {
  slug: string;
  user: User | null;
  quota: Quota | null;
  maxTrackSec: number;
  queue: QueueItem[];
  nowPlaying: QueueItem | null;
}) {
  const location = useLocation();
  const blocked = !!quota && !quota.unlimited && quota.remaining === 0;
  const now = useNow(blocked);
  const wait = blocked && quota.nextSlotAt ? Math.max(0, Math.ceil((Date.parse(quota.nextSlotAt) - now) / 1000)) : 0;
  const waitLabel = blocked
    ? wait > 0
      ? `You can add another song in ${duration(wait)}`
      : "Almost there…"
    : null;

  return (
    // overflow-visible so the results dropdown can extend past the card.
    <Card className="overflow-visible">
      <CardHeader>
        <CardTitle>Add a song</CardTitle>
        <CardDescription>
          Search by artist or title, or paste a link. Up to {Math.round(maxTrackSec / 60)} min
          {quota && !quota.unlimited && <>, {quota.limit} songs every {windowLabel(quota.windowSec)}</>}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {user ? (
          <SongSearch
            slug={slug}
            maxTrackSec={maxTrackSec}
            quota={quota}
            queue={queue}
            nowPlaying={nowPlaying}
            waitLabel={waitLabel}
          />
        ) : (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>Sign in to add songs to this station.</p>
            <Link to="/login" state={{ from: location.pathname }} className={buttonVariants()}>
              Sign in
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ lists

function Row({ item, right }: { item: QueueItem; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <TrackArt src={item.track.thumbnailUrl} className="size-11" />
      <div className="min-w-0 flex-1">
        <a href={item.track.sourceUrl} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline">
          {item.track.title}
        </a>
        <div className="truncate text-xs text-muted-foreground">
          {item.track.artist && <>{item.track.artist} · </>}
          {item.pushedBy.displayName}
        </div>
      </div>
      <div className="shrink-0 text-xs text-muted-foreground tabular-nums">{duration(item.track.durationSec)}</div>
      {right}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="py-10 text-center text-sm text-muted-foreground">{children}</div>;
}

function QueueList({ slug, items, user }: { slug: string; items: QueueItem[]; user: User | null }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/radios/${slug}/queue/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radio", slug] }),
    onError: (e) => toast.error(e.message),
  });
  const total = items.reduce((s, i) => s + (i.track.durationSec ?? 0), 0);

  return (
    <Card>
      <CardContent className="divide-y">
        {items.length === 0 ? (
          <Empty>Nothing queued.</Empty>
        ) : (
          <>
            {items.map((item, i) => (
              <div key={item.id} className="flex items-center gap-3">
                <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <Row
                    item={item}
                    right={
                      user && (user.role === "admin" || user.id === item.pushedBy.id) ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Remove from playlist"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(item.id)}
                        >
                          <Trash2 />
                        </Button>
                      ) : null
                    }
                  />
                </div>
              </div>
            ))}
            <div className="pt-3 text-right text-xs text-muted-foreground">
              {items.length} tracks · {duration(total)}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function HistoryList({ slug }: { slug: string }) {
  const { data, isLoading } = useHistory(slug);
  return (
    <Card>
      <CardContent className="divide-y">
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : !data?.length ? (
          <Empty>Nothing has aired yet.</Empty>
        ) : (
          data.map((item) => (
            <Row
              key={item.id}
              item={item}
              right={
                <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                  {item.status === "skipped" ? "skipped" : item.startedAt ? ago(item.startedAt) : ""}
                </span>
              }
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function TopTracks({ slug }: { slug: string }) {
  const { data, isLoading } = useStats(slug);
  if (isLoading) return <Skeleton className="h-48 rounded-xl" />;
  const max = data?.topTracks[0]?.plays ?? 1;
  return (
    <div className="space-y-4">
      {data && <Totals totals={data.totals} />}
      <Card>
        <CardContent className="space-y-3">
          {!data?.topTracks.length ? (
            <Empty>No plays yet.</Empty>
          ) : (
            data.topTracks.map((t, i) => (
              <div key={t.track.id} className="flex items-center gap-3">
                <span className="w-5 text-right text-sm font-semibold text-muted-foreground tabular-nums">{i + 1}</span>
                <TrackArt src={t.track.thumbnailUrl} className="size-10" />
                <div className="min-w-0 flex-1 space-y-1">
                  <a href={t.track.sourceUrl} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline">
                    {t.track.title}
                  </a>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-red-500/80" style={{ width: `${(t.plays / max) * 100}%` }} />
                  </div>
                </div>
                <span className="w-16 shrink-0 text-right text-sm tabular-nums">
                  {t.plays} <span className="text-xs text-muted-foreground">plays</span>
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TopPlayers({ slug }: { slug: string }) {
  const { data, isLoading } = useStats(slug);
  if (isLoading) return <Skeleton className="h-48 rounded-xl" />;
  const max = data?.topPlayers[0]?.plays ?? 1;
  return (
    <div className="space-y-4">
      {data && <Totals totals={data.totals} />}
      <Card>
        <CardContent className="space-y-3">
          {!data?.topPlayers.length ? (
            <Empty>Nobody has aired a track yet.</Empty>
          ) : (
            data.topPlayers.map((p, i) => (
              <div key={p.user.id} className="flex items-center gap-3">
                <span className="w-5 text-right text-sm font-semibold text-muted-foreground tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="truncate text-sm font-medium">{p.user.displayName}</div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-red-500/80" style={{ width: `${(p.plays / max) * 100}%` }} />
                  </div>
                </div>
                <span className="w-28 shrink-0 text-right text-sm tabular-nums">
                  {p.plays} <span className="text-xs text-muted-foreground">tracks · {hours(p.listenedSec)}</span>
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Totals({ totals }: { totals: { plays: number; uniqueTracks: number; uniquePlayers: number; airtimeSec: number } }) {
  const cells = [
    ["Tracks aired", totals.plays],
    ["Unique tracks", totals.uniqueTracks],
    ["Players", totals.uniquePlayers],
    ["Airtime", hours(totals.airtimeSec)],
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cells.map(([label, value]) => (
        <Card key={label} size="sm">
          <CardContent>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-xl font-semibold tabular-nums">{value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
