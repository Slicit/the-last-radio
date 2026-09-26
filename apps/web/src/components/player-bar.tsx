import { Link } from "react-router";
import { Loader2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { TrackArt } from "@/components/track-art";
import { usePlayer } from "@/hooks/use-player";
import { useRadio } from "@/hooks/use-radio";
import { adderName, closedLabel } from "@/lib/format";

export function PlayerBar() {
  const { station, status, volume, setVolume, tune, stop } = usePlayer();
  const { data } = useRadio(station?.slug);
  if (!station) return null;

  const np = data?.nowPlaying;
  const active = status === "playing" || status === "connecting";
  const subtitle =
    status === "connecting"
      ? "Tuning in…"
      : status === "offline"
        ? (closedLabel(data?.radio.hours ?? { open: true, next: null }) ?? "Stream offline, retrying…")
        : np
          ? (np.track.artist ?? `added by ${adderName(np)}`)
          : data && data.queueTotal > 0
            ? "Changing songs…"
            : "Dead air. Add a song!";

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
        <Button
          size="icon-lg"
          className="rounded-full"
          aria-label={active ? "Stop" : "Play"}
          onClick={() => (active ? stop() : tune(station))}
        >
          {status === "connecting" ? <Loader2 className="animate-spin" /> : active ? <Pause /> : <Play />}
        </Button>
        <TrackArt src={np?.track.thumbnailUrl} className="size-10" />
        <Link to={`/r/${station.slug}`} className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            <span className="text-muted-foreground">{station.name} · </span>
            {np?.track.title ?? "Nothing playing"}
          </div>
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        </Link>
        <div className="hidden w-36 items-center gap-2 sm:flex">
          <button
            type="button"
            aria-label={volume === 0 ? "Unmute" : "Mute"}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setVolume(volume === 0 ? 0.8 : 0)}
          >
            {volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
          <Slider
            value={[Math.round(volume * 100)]}
            max={100}
            aria-label="Volume"
            onValueChange={(v) => setVolume((Array.isArray(v) ? v[0] : v) / 100)}
          />
        </div>
      </div>
    </div>
  );
}
