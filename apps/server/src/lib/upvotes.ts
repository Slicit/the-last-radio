import { and, eq, gt, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db, schema } from "../db/index.js";
import type { Radio } from "../db/schema.js";
import type { PublicUser } from "./auth.js";

const { songUpvotes, queueItems } = schema;

export const UPVOTES_PER_DAY = 3;
const DAY_MS = 24 * 3600_000;

export type UpvoteAllowance = { limit: number; remaining: number; nextAt: string | null };

/** Upvotes left in the rolling 24 hours, across all stations. */
export async function upvoteAllowance(userId: string, tx: Pick<typeof db, "select"> = db): Promise<UpvoteAllowance> {
  const recent = await tx
    .select({ createdAt: songUpvotes.createdAt })
    .from(songUpvotes)
    .where(and(eq(songUpvotes.userId, userId), gt(songUpvotes.createdAt, new Date(Date.now() - DAY_MS))))
    .orderBy(songUpvotes.createdAt);
  const remaining = Math.max(0, UPVOTES_PER_DAY - recent.length);
  const nextAt = remaining === 0 ? new Date(recent[recent.length - UPVOTES_PER_DAY].createdAt.getTime() + DAY_MS).toISOString() : null;
  return { limit: UPVOTES_PER_DAY, remaining, nextAt };
}

/** Which of this station's songs the person has upvoted. */
export async function myUpvotes(radio: Radio, user: PublicUser | null): Promise<string[]> {
  if (!user) return [];
  const rows = await db
    .select({ trackId: songUpvotes.trackId })
    .from(songUpvotes)
    .where(and(eq(songUpvotes.userId, user.id), eq(songUpvotes.radioId, radio.id)));
  return rows.map((r) => r.trackId);
}

export async function upvote(radio: Radio, user: PublicUser, trackId: string) {
  // Only songs this station has played or lined up can be upvoted here.
  const [known] = await db
    .select({ id: queueItems.id })
    .from(queueItems)
    .where(and(eq(queueItems.radioId, radio.id), eq(queueItems.trackId, trackId)))
    .limit(1);
  if (!known) throw new HTTPException(404, { message: "That song hasn't been on this station" });

  return db.transaction(async (tx) => {
    // One at a time per person, so the daily count below is race-free.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`upvote:${user.id}`}))`);
    const existing = await tx
      .select({ t: songUpvotes.trackId })
      .from(songUpvotes)
      .where(and(eq(songUpvotes.userId, user.id), eq(songUpvotes.radioId, radio.id), eq(songUpvotes.trackId, trackId)));
    if (existing.length) return { already: true, allowance: await upvoteAllowance(user.id, tx) };
    const a = await upvoteAllowance(user.id, tx);
    if (a.remaining === 0) {
      const hrs = Math.max(1, Math.ceil((Date.parse(a.nextAt!) - Date.now()) / 3600_000));
      throw new HTTPException(429, { message: `You've used your ${UPVOTES_PER_DAY} upvotes for today. More in ~${hrs} h.` });
    }
    await tx.insert(songUpvotes).values({ userId: user.id, radioId: radio.id, trackId });
    return { already: false, allowance: await upvoteAllowance(user.id, tx) };
  });
}

export async function removeUpvote(radio: Radio, user: PublicUser, trackId: string) {
  await db
    .delete(songUpvotes)
    .where(and(eq(songUpvotes.userId, user.id), eq(songUpvotes.radioId, radio.id), eq(songUpvotes.trackId, trackId)));
  return { allowance: await upvoteAllowance(user.id) };
}
