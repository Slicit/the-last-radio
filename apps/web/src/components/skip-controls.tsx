import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SkipForward, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type QueueItem, type RadioDetail, type SkipState } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * What a person can do about the song on air:
 * - admins skip instantly,
 * - whoever added it can skip their own pick,
 * - everyone else who is listening votes; enough votes skip it.
 */
export function SkipControls({
  slug,
  item,
  skip,
  isAdmin,
  signedIn,
  tunedIn,
}: {
  slug: string;
  item: QueueItem;
  skip: SkipState | null;
  isAdmin: boolean;
  signedIn: boolean;
  /** Whether this browser is playing the station (the server may not know yet). */
  tunedIn: boolean;
}) {
  const qc = useQueryClient();
  const key = ["radio", slug];
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const skipNow = useMutation({
    mutationFn: () => api.post<{ skipped: boolean }>(`/radios/${slug}/skip`),
    onSuccess: (d) => {
      if (d.skipped) toast.success("Skipped");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const vote = useMutation({
    mutationFn: (on: boolean) =>
      on
        ? api.post<{ skipped: boolean }>(`/radios/${slug}/votes`, { itemId: item.id })
        : api.del<{ skipped?: boolean }>(`/radios/${slug}/votes/${item.id}`),
    // Flip the button immediately; the server answer reconciles it.
    onMutate: (on) => {
      qc.setQueryData<RadioDetail & { clockSkewMs: number }>(key, (d) =>
        d?.skip ? { ...d, skip: { ...d.skip, voted: on, votes: d.skip.votes + (on ? 1 : -1) } } : d,
      );
    },
    onSuccess: (d) => {
      if (d.skipped) toast.success("Voted off. Next song!");
    },
    onError: (e) => toast.error(e.message),
    onSettled: refresh,
  });

  if (isAdmin || skip?.isOwner) {
    return (
      <Button variant="outline" size="lg" disabled={skipNow.isPending} onClick={() => skipNow.mutate()}>
        <SkipForward /> {isAdmin ? "Skip" : "Skip my song"}
      </Button>
    );
  }

  if (!skip?.enabled) return null;

  const tally = `${skip.votes}/${skip.needed}`;
  if (!signedIn) {
    return skip.votes > 0 ? (
      <span className="text-sm text-muted-foreground">
        {skip.votes} of {skip.needed} votes to skip
      </span>
    ) : null;
  }

  const hint = !tunedIn ? "Tune in to vote" : !skip.canVote ? "Connecting…" : null;
  return (
    <div className="flex items-center gap-2">
      <Button
        variant={skip.voted ? "secondary" : "outline"}
        size="lg"
        aria-pressed={skip.voted}
        disabled={!skip.canVote || vote.isPending}
        onClick={() => vote.mutate(!skip.voted)}
        title={skip.voted ? "Take back your vote" : "Vote to skip this song"}
      >
        <ThumbsDown className={cn(skip.voted && "fill-current")} />
        {skip.voted ? "Voted to skip" : "Vote to skip"}
        <span className="ml-0.5 text-xs text-muted-foreground tabular-nums">{tally}</span>
      </Button>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}
