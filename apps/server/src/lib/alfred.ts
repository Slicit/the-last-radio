import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { Radio } from "../db/schema.js";
import { songRecords } from "./track-stats.js";

const { queueItems, tracks } = schema;

// Don't bring back a song that aired this recently.
const RECENT_MS = 3 * 3600_000;
const MAX_PICKS_PER_RUN = 5;
const CANDIDATES = 200;

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
 * `autofillBelowSec` is lined up, he queues songs from this station's record
 * (see track-stats), drawing at random weighted by each song's score, so
 * crowd favourites come back often and downvoted songs rarely or never. He
 * never picks a song whose last airing was voted off, one that aired in the
 * last few hours, or one already lined up. His picks carry `isFill` so
 * anything a person adds plays first.
 */
export async function alfredTopUp(radio: Radio): Promise<string[]> {
  if (radio.autofillBelowSec <= 0) return [];
  let lined = await lineupSeconds(radio.id);
  if (lined >= radio.autofillBelowSec) return [];

  const busyRows = await db
    .selectDistinct({ id: queueItems.trackId })
    .from(queueItems)
    .where(
      and(
        eq(queueItems.radioId, radio.id),
        sql`(${queueItems.status} in ('queued', 'playing') or ${queueItems.startedAt} > ${new Date(Date.now() - RECENT_MS).toISOString()}::timestamptz)`,
      ),
    );
  const busy = new Set(busyRows.map((r) => r.id));

  const pool = (await songRecords(radio.id, "score", CANDIDATES)).filter(
    (s) =>
      s.alfredOk &&
      !busy.has(s.track.id) &&
      s.track.durationSec != null &&
      s.track.durationSec > 0 &&
      s.track.durationSec <= radio.maxTrackSec,
  );

  const picked: string[] = [];
  while (lined < radio.autofillBelowSec && picked.length < MAX_PICKS_PER_RUN && pool.length) {
    const total = pool.reduce((n, s) => n + s.score, 0);
    let r = Math.random() * total;
    const i = Math.max(0, pool.findIndex((s) => (r -= s.score) < 0));
    const [choice] = pool.splice(i, 1);
    await db.insert(queueItems).values({ radioId: radio.id, trackId: choice.track.id, userId: null, isFill: true });
    lined += choice.track.durationSec ?? 0;
    picked.push(`${choice.track.title} (score ${choice.score})`);
  }
  return picked;
}
