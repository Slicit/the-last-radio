import { and, count, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { QueueItem, Radio } from "../db/schema.js";
import type { PublicUser } from "./auth.js";
import { isListening, listenerCount } from "./listeners.js";

const { queueItems, skipVotes } = schema;
type SkipReason = NonNullable<QueueItem["skipReason"]>;

export type SkipState = {
  enabled: boolean;
  votes: number;
  needed: number;
  voted: boolean;
  /** Only signed-in people who are tuned in may vote. */
  canVote: boolean;
  /** The person who added the song may always skip it. */
  isOwner: boolean;
};

/** Votes needed right now: a share of current listeners, never less than one. */
export function votesNeeded(radio: Radio): number {
  return Math.max(1, Math.ceil((listenerCount(radio.id) * radio.skipVotePercent) / 100));
}

export async function voteCount(itemId: string): Promise<number> {
  const [{ n }] = await db.select({ n: count() }).from(skipVotes).where(eq(skipVotes.queueItemId, itemId));
  return n;
}

/** Ends the on-air item; the broadcaster notices within a second and cuts the audio. */
export async function skipItem(itemId: string, reason: SkipReason): Promise<boolean> {
  const res = await db
    .update(queueItems)
    .set({ status: "skipped", skipReason: reason, endedAt: new Date() })
    .where(and(eq(queueItems.id, itemId), eq(queueItems.status, "playing")))
    .returning({ id: queueItems.id });
  return res.length > 0;
}

export async function skipState(
  radio: Radio,
  item: { id: string; pushedBy: { id: string | null } | null } | null,
  user: PublicUser | null,
): Promise<SkipState | null> {
  if (!item) return null;
  const enabled = radio.skipVotePercent > 0;
  const [votes, voted] = await Promise.all([
    voteCount(item.id),
    user
      ? db
          .select({ u: skipVotes.userId })
          .from(skipVotes)
          .where(and(eq(skipVotes.queueItemId, item.id), eq(skipVotes.userId, user.id)))
          .then((r) => r.length > 0)
      : false,
  ]);
  return {
    enabled,
    votes,
    needed: votesNeeded(radio),
    voted,
    canVote: enabled && !!user && isListening(radio.id, user.id),
    isOwner: !!user && user.id === item.pushedBy?.id,
  };
}

/**
 * Skips the on-air song if its votes meet the current threshold. Called on
 * every vote, and on listener heartbeats so a song also goes when enough
 * listeners leave that the votes already cast become a majority.
 */
export async function applyVotes(radio: Radio, itemId: string): Promise<boolean> {
  if (radio.skipVotePercent <= 0) return false;
  if ((await voteCount(itemId)) < votesNeeded(radio)) return false;
  return skipItem(itemId, "votes");
}
