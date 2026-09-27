import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { Radio } from "../db/schema.js";
import { songRecords } from "./track-stats.js";

const { queueItems, tracks } = schema;

// Never repeat a song that aired this recently…
const REPEAT_GAP_MS = 30 * 60_000;
// …or one that couldn't be fetched lately (its site may be blocking us for now).
const FAILED_GAP_MS = 60 * 60_000;
// …and within this long, make it progressively less likely rather than
// impossible: a small library would otherwise leave Alfred nothing to play.
const FRESH_AFTER_MS = 3 * 3600_000;
const MIN_FRESHNESS = 0.1;
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

// Say why Alfred is idle, but not every 10 seconds.
const lastQuietLog = new Map<string, number>();
function quietLog(radio: Radio, message: string) {
  const last = lastQuietLog.get(radio.id) ?? 0;
  if (Date.now() - last < 10 * 60_000) return;
  lastQuietLog.set(radio.id, Date.now());
  console.log(`[${radio.slug}] ${message}`);
}

/**
 * Alfred keeps the station from going quiet: when less than
 * `autofillBelowSec` is lined up, he queues songs from this station's record
 * (see track-stats), drawing at random weighted by each song's score, so
 * crowd favourites come back often and downvoted songs rarely or never. He
 * never picks a song whose last airing was voted off, one that aired in the
 * last 30 minutes, one that failed to download in the last hour, or one
 * already lined up; songs from the last 3 hours are
 * less likely the more recently they played. His picks carry `isFill` so
 * anything a person adds plays first. `random` is there so tests can make
 * the draw repeatable.
 */
export async function alfredTopUp(radio: Radio, random: () => number = Math.random): Promise<string[]> {
  if (radio.autofillBelowSec <= 0) return [];
  let lined = await lineupSeconds(radio.id);
  if (lined >= radio.autofillBelowSec) return [];

  const busyRows = await db
    .selectDistinct({ id: queueItems.trackId })
    .from(queueItems)
    .where(
      and(
        eq(queueItems.radioId, radio.id),
        sql`(${queueItems.status} in ('queued', 'playing')
          or ${queueItems.startedAt} > ${new Date(Date.now() - REPEAT_GAP_MS).toISOString()}::timestamptz
          or (${queueItems.status} = 'failed' and ${queueItems.endedAt} > ${new Date(Date.now() - FAILED_GAP_MS).toISOString()}::timestamptz))`,
      ),
    );
  const busy = new Set(busyRows.map((r) => r.id));
  // Two uploads of the same song have different ids: compare titles too.
  const sameSong = (title: string) => title.toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const lineupTitles = new Set(
    (
      await db
        .select({ title: tracks.title })
        .from(queueItems)
        .innerJoin(tracks, eq(tracks.id, queueItems.trackId))
        .where(and(eq(queueItems.radioId, radio.id), inArray(queueItems.status, ["queued", "playing"])))
    ).map((r) => sameSong(r.title)),
  );

  const pool = (await songRecords(radio.id, "score", CANDIDATES)).filter(
    (s) =>
      s.alfredOk &&
      !busy.has(s.track.id) &&
      !lineupTitles.has(sameSong(s.track.title)) &&
      s.track.durationSec != null &&
      s.track.durationSec > 0 &&
      s.track.durationSec <= radio.maxTrackSec,
  );

  if (!pool.length) {
    quietLog(radio, "Alfred has nothing to play: every song this station knows is queued, too recent, too long or unloved");
    return [];
  }

  // Weight = score × freshness: long-unplayed favourites come back most.
  const now = Date.now();
  const weight = (s: (typeof pool)[number]) => {
    const since = s.lastPlayedAt ? now - Date.parse(s.lastPlayedAt) : FRESH_AFTER_MS;
    return s.score * Math.min(1, Math.max(MIN_FRESHNESS, since / FRESH_AFTER_MS));
  };

  const picked: string[] = [];
  while (lined < radio.autofillBelowSec && picked.length < MAX_PICKS_PER_RUN && pool.length) {
    const total = pool.reduce((n, s) => n + weight(s), 0);
    let r = random() * total;
    const i = Math.max(0, pool.findIndex((s) => (r -= weight(s)) < 0));
    const [choice] = pool.splice(i, 1);
    // Drop other uploads of the song just picked.
    for (let j = pool.length - 1; j >= 0; j--) if (sameSong(pool[j].track.title) === sameSong(choice.track.title)) pool.splice(j, 1);
    await db.insert(queueItems).values({ radioId: radio.id, trackId: choice.track.id, userId: null, isFill: true });
    lined += choice.track.durationSec ?? 0;
    picked.push(`${choice.track.title} (score ${choice.score})`);
  }
  return picked;
}
