import { ListPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAddSong } from "@/hooks/use-add-song";

/** What's already lined up, so "add again" can say why it isn't offered. */
export type Lineup = {
  slug: string;
  signedIn: boolean;
  onAirKey: string | null;
  queuedKeys: Set<string>;
  maxTrackSec: number;
  /** Set when the listener has used up their adds for now. */
  blockedReason: string | null;
};

export function AddAgain({
  lineup,
  track,
}: {
  lineup: Lineup;
  track: { id: string; sourceKey: string; title: string; durationSec: number | null };
}) {
  const add = useAddSong(lineup.slug);
  if (!lineup.signedIn) return null;

  const status =
    track.sourceKey === lineup.onAirKey
      ? "On air"
      : lineup.queuedKeys.has(track.sourceKey)
        ? "In line"
        : (track.durationSec ?? 0) > lineup.maxTrackSec
          ? "Too long"
          : null;
  if (status) return <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">{status}</span>;

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="shrink-0"
      aria-label={`Add “${track.title}” again`}
      title={lineup.blockedReason ?? "Add again"}
      disabled={!!lineup.blockedReason || add.isPending}
      onClick={() => add.mutate({ key: track.id, target: { trackId: track.id } })}
    >
      {add.isPending ? <Loader2 className="animate-spin" /> : <ListPlus />}
    </Button>
  );
}
