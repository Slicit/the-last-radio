import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type RadioDetail, type UpvoteAllowance } from "@/lib/api";
import { cn } from "@/lib/utils";

export type UpvoteState = {
  slug: string;
  signedIn: boolean;
  mine: Set<string>;
  allowance: UpvoteAllowance | null;
};

/** "Play this more": Alfred picks upvoted songs more often. 3 a day. */
export function UpvoteButton({
  state,
  trackId,
  count = 0,
  size = "sm",
}: {
  state: UpvoteState;
  trackId: string;
  count?: number;
  size?: "sm" | "lg";
}) {
  const qc = useQueryClient();
  const upvoted = state.mine.has(trackId);
  const left = state.allowance?.remaining ?? 0;
  // `wasUpvoted` travels with each click: after the optimistic flip below,
  // the component's own `upvoted` already shows the new state.
  const toggle = useMutation({
    mutationFn: (wasUpvoted: boolean) =>
      wasUpvoted
        ? api.del<{ allowance: UpvoteAllowance }>(`/radios/${state.slug}/upvotes/${trackId}`)
        : api.post<{ allowance: UpvoteAllowance }>(`/radios/${state.slug}/upvotes`, { trackId }),
    // Flip it at once; the refetch reconciles counts.
    onMutate: (wasUpvoted) => {
      qc.setQueryData<RadioDetail & { clockSkewMs: number }>(["radio", state.slug], (d) =>
        d
          ? {
              ...d,
              myUpvotes: wasUpvoted ? d.myUpvotes.filter((t) => t !== trackId) : [...d.myUpvotes, trackId],
              upvotes: d.upvotes && { ...d.upvotes, remaining: d.upvotes.remaining + (wasUpvoted ? 1 : -1) },
            }
          : d,
      );
    },
    onSuccess: ({ allowance }, wasUpvoted) => {
      if (!wasUpvoted) {
        toast.success("Upvoted: Alfred will play it more", {
          description: `${allowance.remaining} upvote${allowance.remaining === 1 ? "" : "s"} left today.`,
        });
      }
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => qc.invalidateQueries({ queryKey: ["radio", state.slug] }),
  });

  const title = !state.signedIn
    ? "Sign in to upvote"
    : upvoted
      ? "Take back your upvote"
      : left === 0
        ? "No upvotes left today"
        : `Play this more (${left} upvote${left === 1 ? "" : "s"} left today)`;
  const shown = count;

  return (
    <Button
      type="button"
      variant={upvoted ? "secondary" : "ghost"}
      size={size === "lg" ? "lg" : "sm"}
      aria-pressed={upvoted}
      aria-label={upvoted ? "Take back your upvote" : "Upvote"}
      title={title}
      disabled={!state.signedIn || toggle.isPending || (!upvoted && left === 0)}
      onClick={() => toggle.mutate(upvoted)}
      className={cn("shrink-0 gap-1 tabular-nums", upvoted && "text-brand")}
    >
      <ThumbsUp className={cn(upvoted && "fill-current")} />
      {size === "lg" ? (upvoted ? "Upvoted" : "Upvote") : null}
      {shown > 0 && <span className={cn("text-xs", size === "lg" && "text-muted-foreground")}>{shown}</span>}
    </Button>
  );
}
