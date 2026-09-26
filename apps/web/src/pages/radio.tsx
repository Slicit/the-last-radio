import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Clock, ExternalLink, Headphones, Loader2, Lock, Moon, Pause, Play, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { TrackArt } from "@/components/track-art";
import { SongSearch } from "@/components/song-search";
import { SkipControls } from "@/components/skip-controls";
import { AddAgain, type Lineup } from "@/components/add-again";
import { UpvoteButton, type UpvoteState } from "@/components/upvote-button";
import { SongsList } from "@/components/songs-list";
import { OnAir } from "@/components/on-air";
import { useMe } from "@/hooks/use-auth";
import { usePlayer } from "@/hooks/use-player";
import { useElapsed, useHistory, useNow, useQueuePage, useRadio, useStats, useStream } from "@/hooks/use-radio";
import { Pager } from "@/components/pager";
import { api, type QueueItem, type Quota, type RadioStats, type SkipState, type User } from "@/lib/api";
import { cn } from "@/lib/utils";
import { adderName, ago, closedLabel, duration, hours, hoursSummary, nextOpening, windowLabel } from "@/lib/format";

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

  const { radio, quota } = data;
  const blocked = !!quota && !quota.unlimited && quota.remaining === 0;
  const upvote: UpvoteState = {
    slug: radio.slug,
    signedIn: !!user,
    mine: new Set(data.myUpvotes),
    allowance: data.upvotes,
  };
  const lineup: Lineup = {
    upvote,
    slug: radio.slug,
    signedIn: !!user,
    onAirKey: data.nowPlaying?.track.sourceKey ?? null,
    queuedKeys: new Set(data.queuedKeys),
    maxTrackSec: radio.maxTrackSec,
    blockedReason: blocked
      ? `You can add another song in ~${Math.max(1, Math.ceil((Date.parse(quota.nextSlotAt ?? "") - Date.now()) / 60_000) || 1)} min`
      : null,
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
              {radio.isPrivate && <Lock className="size-6" aria-label="Private station" />}
              {radio.name}
            </h1>
            <OnAir live={!!stream?.live} closed={!radio.hours.open} />
            {!radio.isActive && <Badge variant="outline">disabled</Badge>}
          </div>
          {radio.description && <p className="text-muted-foreground">{radio.description}</p>}
          {radio.hoursEnabled && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="size-3.5" /> {hoursSummary(radio)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Headphones className="size-4" /> {stream?.listeners ?? 0} listening
        </div>
      </div>

      {!radio.hours.open && (
        <Alert>
          <Moon />
          {data.nowPlaying ? (
            <>
              <AlertTitle>Last song of the day</AlertTitle>
              <AlertDescription>
                The station has closed; this song plays to the end.
                {radio.hours.next && <> Back {nextOpening(radio.hours.next)}, with the queue kept.</>}
              </AlertDescription>
            </>
          ) : (
            <>
              <AlertTitle>{closedLabel(radio.hours)}</AlertTitle>
              <AlertDescription>
                The queue is kept: songs added now will play when the station opens. Stay tuned in and the music
                starts by itself.
              </AlertDescription>
            </>
          )}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <NowPlaying
          slug={radio.slug}
          name={radio.name}
          item={data.nowPlaying}
          upNext={data.queue[0] ?? null}
          upvote={upvote}
          clockSkewMs={data.clockSkewMs}
          closed={!radio.hours.open}
          isAdmin={user?.role === "admin"}
          signedIn={!!user}
          skip={data.skip}
        />
        <AddSongCard
          slug={radio.slug}
          user={user}
          quota={data.quota}
          maxTrackSec={radio.maxTrackSec}
          queuedKeys={data.queuedKeys}
          nowPlaying={data.nowPlaying}
          opensLabel={radio.hours.next && !radio.hours.open ? nextOpening(radio.hours.next) : null}
        />
      </div>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Up next ({data.queueTotal})</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="songs">Songs</TabsTrigger>
          <TabsTrigger value="players">Top players</TabsTrigger>
        </TabsList>
        <TabsContent value="queue">
          <QueueList slug={radio.slug} user={user} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryList slug={radio.slug} lineup={lineup} />
        </TabsContent>
        <TabsContent value="songs">
          <SongsList slug={radio.slug} lineup={lineup} />
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
  upNext,
  upvote,
  clockSkewMs,
  closed,
  isAdmin,
  signedIn,
  skip,
}: {
  slug: string;
  name: string;
  item: QueueItem | null;
  /** Shown while the broadcaster switches songs (a skip, a song ending). */
  upNext: QueueItem | null;
  upvote: UpvoteState;
  clockSkewMs: number;
  closed: boolean;
  isAdmin: boolean;
  signedIn: boolean;
  skip: SkipState | null;
}) {
  const player = usePlayer();
  const tunedHere = player.station?.slug === slug;
  const listening = tunedHere && (player.status === "playing" || player.status === "connecting");
  const elapsed = useElapsed(item?.startedAt, clockSkewMs, listening ? player.latency : 0);
  const total = item?.track.durationSec ?? null;
  // Between two songs (after a skip, say) something is still lined up: that's not dead air.
  const changing = !item && !closed && !!upNext;


  return (
    <Card>
      <CardContent className="flex flex-col gap-6 sm:flex-row">
        <TrackArt
          src={item?.track.thumbnailUrl ?? (changing ? upNext?.track.thumbnailUrl : null)}
          className={cn("aspect-square w-full sm:w-48", changing && "opacity-50")}
        />
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              {changing ? "Up next" : "Now playing"}
            </div>
            <div className="flex items-center gap-2 text-2xl leading-tight font-semibold break-words">
              {changing && <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />}
              {item?.track.title ?? (closed ? "Closed for now" : changing ? upNext!.track.title : "Dead air")}
            </div>
            <div className="text-muted-foreground">
              {item ? (
                <>
                  {item.track.artist && <>{item.track.artist} · </>}
                  added by <span className="text-foreground">{adderName(item)}</span>
                </>
              ) : closed ? (
                "Nothing playing until the station opens."
              ) : changing ? (
                "Coming up in a moment…"
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
            {item && <UpvoteButton state={upvote} trackId={item.track.id} count={item.track.upvotes} size="lg" />}
            {item && (
              <SkipControls
                slug={slug}
                item={item}
                skip={skip}
                isAdmin={isAdmin}
                signedIn={signedIn}
                tunedIn={listening}
              />
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
  queuedKeys,
  nowPlaying,
  opensLabel,
}: {
  slug: string;
  user: User | null;
  quota: Quota | null;
  maxTrackSec: number;
  queuedKeys: string[];
  nowPlaying: QueueItem | null;
  /** Set while the station is closed: when added songs will start playing. */
  opensLabel: string | null;
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
          Search by artist or title on YouTube or SoundCloud, or paste a link from YouTube, SoundCloud, Bandcamp,
          Mixcloud and more. Up to {Math.round(maxTrackSec / 60)} min
          {quota && !quota.unlimited && <>, {quota.limit} songs every {windowLabel(quota.windowSec)}</>}.
          {opensLabel && <> Songs you add now play when the station opens {opensLabel}.</>}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {user ? (
          <SongSearch
            slug={slug}
            maxTrackSec={maxTrackSec}
            quota={quota}
            queuedKeys={queuedKeys}
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

function AlfredTag() {
  return (
    <span
      className="inline-flex items-center gap-1 text-muted-foreground"
      title="Alfred picks songs this station played before when the queue runs low"
    >
      <Bot className="size-3" /> Alfred
    </span>
  );
}

function Row({ item, right }: { item: QueueItem; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <TrackArt src={item.track.thumbnailUrl} className="size-11" />
      <div className="min-w-0 flex-1">
        <a href={item.track.sourceUrl} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline">
          {item.track.title}
        </a>
        <div className="truncate text-xs text-muted-foreground">
          {item.track.unavailable && <span className="text-destructive">No longer available · </span>}
          {item.track.artist && <>{item.track.artist} · </>}
          {item.isFill ? <AlfredTag /> : adderName(item)}
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

function QueueList({ slug, user }: { slug: string; user: User | null }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { data } = useQueuePage(slug, page, pageSize);
  const items = data?.items ?? [];
  const offset = (page - 1) * pageSize;
  // The list shrank under us (songs played): step back to a page that exists.
  useEffect(() => {
    if (data && page > 1 && data.items.length === 0) setPage(Math.max(1, Math.ceil(data.total / pageSize)));
  }, [data, page, pageSize]);
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/radios/${slug}/queue/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radio", slug] }),
    onError: (e) => toast.error(e.message),
  });
  return (
    <Card>
      <CardContent className="divide-y">
        {items.length === 0 ? (
          <Empty>Nothing queued.</Empty>
        ) : (
          <>
            {items.map((item, i) => (
              <Fragment key={item.id}>
                {item.isFill && !items[i - 1]?.isFill && (
                  <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                    <Bot className="size-3.5" />
                    Alfred's picks keep the music going. Songs people add always play first.
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <span className="w-6 text-right text-xs text-muted-foreground tabular-nums">{offset + i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <Row
                      item={item}
                      right={
                        user && (user.role === "admin" || user.id === item.pushedBy?.id) ? (
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
              </Fragment>
            ))}
            <div className="pt-3 text-right text-xs text-muted-foreground">
              {data?.total} tracks · {duration(data?.totalDurationSec ?? 0)}
            </div>
            <Pager page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} onPageSize={setPageSize} label="songs" />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function skippedLabel(reason: QueueItem["skipReason"]): string {
  switch (reason) {
    case "votes":
      return "voted off";
    case "owner":
      return "skipped by its adder";
    case "admin":
      return "skipped by an admin";
    case "interrupted":
      return "cut off";
    default:
      return "skipped";
  }
}

function HistoryList({ slug, lineup }: { slug: string; lineup: Lineup }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { data, isLoading } = useHistory(slug, page, pageSize);
  return (
    <Card>
      <CardContent className="divide-y">
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : !data?.items.length ? (
          <Empty>Nothing has aired yet.</Empty>
        ) : (
          data.items.map((item) => (
            <Row
              key={item.id}
              item={item}
              right={
                <>
                  <span className="w-32 shrink-0 text-right text-xs text-muted-foreground">
                    {item.startedAt ? ago(item.startedAt) : ""}
                    {item.status === "skipped" && (
                      <span className="block text-muted-foreground/70">{skippedLabel(item.skipReason)}</span>
                    )}
                  </span>
                  <UpvoteButton state={lineup.upvote} trackId={item.track.id} count={item.track.upvotes} />
                  <AddAgain lineup={lineup} track={item.track} />
                </>
              }
            />
          ))
        )}
        <Pager page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} onPageSize={setPageSize} label="songs" />
      </CardContent>
    </Card>
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
                    <div className="h-full rounded-full bg-brand/80" style={{ width: `${(p.plays / max) * 100}%` }} />
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

function Totals({ totals }: { totals: RadioStats["totals"] }) {
  const cells = [
    ["Songs aired", totals.plays],
    ["Different songs", totals.uniqueTracks],
    ["People adding", totals.uniquePlayers],
    ["Downvotes", totals.downvotes],
    ["Airtime", hours(totals.airtimeSec)],
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
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
