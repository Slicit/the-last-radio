import { Link } from "react-router";
import { Headphones, ListMusic, Lock, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrackArt } from "@/components/track-art";
import { SampleBadge } from "@/components/sample-badge";
import { OnAir } from "@/components/on-air";
import { useRadios } from "@/hooks/use-radio";
import { usePlayer } from "@/hooks/use-player";
import { useMe } from "@/hooks/use-auth";
import { adderName, closedLabel } from "@/lib/format";

export function HomePage() {
  const { data: radios, isLoading } = useRadios();
  const { tune } = usePlayer();
  const { user } = useMe();

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Tune in.</h1>
        <p className="max-w-xl text-muted-foreground">
          Every station plays one shared stream, and the listeners pick the music. Find a song, add it,
          and everyone hears it together.
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : !radios?.length ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No stations yet.{" "}
            {user?.role === "admin" ? (
              <Link to="/admin" className="text-foreground underline">
                Create the first one
              </Link>
            ) : (
              "An admin needs to create one."
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {radios.map((r) => (
            <Card key={r.id} className="group relative overflow-hidden">
              <CardContent className="space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/r/${r.slug}`} className="inline-flex items-center gap-1.5 text-lg font-semibold after:absolute after:inset-0">
                      {r.isPrivate && <Lock className="size-4" aria-label="Private" />}
                      {r.name}
                    </Link>
                    <p className="line-clamp-1 text-sm text-muted-foreground">{r.description || `/${r.slug}`}</p>
                  </div>
                  {r.isActive ? (
                    <OnAir live={!!r.nowPlaying} closed={!r.hours.open} />
                  ) : (
                    <Badge variant="outline">disabled</Badge>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <TrackArt src={r.nowPlaying?.track.thumbnailUrl} className="size-14" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {r.nowPlaying?.track.isPreview && <SampleBadge className="mr-1.5" />}
                      {r.nowPlaying?.track.title ?? "Waiting for a track"}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.nowPlaying
                        ? `added by ${adderName(r.nowPlaying)}`
                        : (closedLabel(r.hours) ?? "Playlist is empty")}
                    </div>
                  </div>
                  <Button
                    size="icon-lg"
                    className="relative z-10 rounded-full"
                    aria-label={`Listen to ${r.name}`}
                    onClick={() => tune({ slug: r.slug, name: r.name })}
                  >
                    <Play />
                  </Button>
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Headphones className="size-3.5" /> {r.listeners}
                  </span>
                  <span className="flex items-center gap-1">
                    <ListMusic className="size-3.5" /> {r.queueLength} queued
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
