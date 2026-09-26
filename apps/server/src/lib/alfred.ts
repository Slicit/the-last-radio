import { and, desc, eq, gt, inArray, isNotNull, lte, notInArray, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { Radio } from "../db/schema.js";

const { queueItems, tracks } = schema;

// Don't bring back a song that aired this recently.
const RECENT_MS = 3 * 3600_000;
const MAX_PICKS_PER_RUN = 5;
const CANDIDATES = 50;

/** Seconds of music lined up: what's left of the song on air plus everything queued. */
export async function lineupSeconds(radioId: string): Promise<number> {
  const [row] = await db
    .select({
      queued: sql<number>`coalesce(sum(${tracks.durationSec}) filter (where ${queueItems.status} = 'queued'), 0)::int`,
      remaining: sql<number>`coalesce(max(greatest(0, ${tracks.durationSec} - extract(epoch from now() - ${queueItems.startedAt}))) filter (where ${queueItems.status} = 'playing'), 0)::int`,
    })
    .from(queueItems)
    .innerJoin(tracks, eq(tracks.id, queueItems.trackId))
    .where(and(eq(queueItems.radioId, radioId), inArray(queueItems.status, ["queued", "playing"])));
  return (row?.queued ?? 0) + (row?.remaining ?? 0);
}

/**
 * Alfred keeps the station from going quiet: when less than
 * `autofillBelowSec` is lined up, he queues songs this station has played
 * before. He favours songs that played to the end often, never picks one
 * that was skipped or voted off last time, and avoids recent repeats. His
 * picks carry `isFill` so anything a person adds plays first.
 */
export async function alfredTopUp(radio: Radio): Promise<string[]> {
  if (radio.autofillBelowSec <= 0) return [];
  let lined = await lineupSeconds(radio.id);
  if (lined >= radio.autofillBelowSec) return [];

  const busy = db
    .select({ id: queueItems.trackId })
    .from(queueItems)
    .where(
      and(
        eq(queueItems.radioId, radio.id),
        sql`(${queueItems.status} in ('queued', 'playing') or ${queueItems.startedAt} > ${new Date(Date.now() - RECENT_MS).toISOString()}::timestamptz)`,
      ),
    );

  // Each track's play count here, and how its latest airing ended.
  const lastOutcome = sql<string>`(array_agg(${queueItems.status} order by ${queueItems.startedAt} desc))[1]`;
  const plays = sql<number>`count(*) filter (where ${queueItems.status} = 'played')::int`;
  const candidates = await db
    .select({ trackId: tracks.id, title: tracks.title, durationSec: tracks.durationSec, plays, lastOutcome })
    .from(queueItems)
    .innerJoin(tracks, eq(tracks.id, queueItems.trackId))
    .where(
      and(
        eq(queueItems.radioId, radio.id),
        isNotNull(queueItems.startedAt),
        isNotNull(tracks.durationSec),
        lte(tracks.durationSec, radio.maxTrackSec),
        gt(tracks.durationSec, 0),
        notInArray(tracks.id, busy),
      ),
    )
    .groupBy(tracks.id)
    .orderBy(desc(plays))
    .limit(CANDIDATES);

  // Weighted draw: a song that played to the end 4 times is 4x as likely as one that played once.
  const pool = candidates.filter((c) => c.lastOutcome === "played" && c.plays > 0);
  const picked: string[] = [];
  while (lined < radio.autofillBelowSec && picked.length < MAX_PICKS_PER_RUN && pool.length) {
    const total = pool.reduce((n, c) => n + c.plays, 0);
    let r = Math.random() * total;
    const i = Math.max(0, pool.findIndex((c) => (r -= c.plays) < 0));
    const [choice] = pool.splice(i, 1);
    await db.insert(queueItems).values({ radioId: radio.id, trackId: choice.trackId, userId: null, isFill: true });
    lined += choice.durationSec ?? 0;
    picked.push(choice.title);
  }
  return picked;
}
