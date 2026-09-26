import { and, asc, eq, exists, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { probe, ProbeError } from "./ytdlp.js";

const { tracks, queueItems } = schema;

export const CHECK_EVERY_DAYS = Number(process.env.SONG_CHECK_INTERVAL_DAYS ?? 7);
const RETRY_AFTER_TRANSIENT_MS = 24 * 3600_000;
const BATCH = 25;

import { looksGone } from "./gone.js";
export { looksGone };

type Probe = (url: string) => Promise<unknown>;

export async function markUnavailable(trackId: string, reason: string) {
  await db
    .update(tracks)
    .set({ unavailableAt: new Date(), unavailableReason: reason.slice(0, 300), checkedAt: new Date() })
    .where(and(eq(tracks.id, trackId), isNull(tracks.unavailableAt)));
}

export async function markAvailable(trackId: string) {
  await db.update(tracks).set({ unavailableAt: null, unavailableReason: null, checkedAt: new Date() }).where(eq(tracks.id, trackId));
}

/**
 * Re-checks a batch of songs that are due (never checked, or not for
 * CHECK_EVERY_DAYS). Only songs some station still knows are checked, and
 * songs already known gone aren't checked again. Returns what it found.
 */
export async function checkSongs(check: Probe = probe, now = new Date()) {
  const due = new Date(now.getTime() - CHECK_EVERY_DAYS * 24 * 3600_000);
  const batch = await db
    .select({ id: tracks.id, url: tracks.sourceUrl, title: tracks.title })
    .from(tracks)
    .where(
      and(
        isNull(tracks.unavailableAt),
        or(isNull(tracks.checkedAt), lt(tracks.checkedAt, due)),
        exists(db.select({ one: sql`1` }).from(queueItems).where(eq(queueItems.trackId, tracks.id))),
      ),
    )
    .orderBy(asc(sql`coalesce(${tracks.checkedAt}, 'epoch')`))
    .limit(BATCH);

  const result = { checked: 0, gone: [] as string[], retry: 0 };
  for (const t of batch) {
    try {
      await check(t.url);
      await markAvailable(t.id);
      result.checked++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof ProbeError && looksGone(message)) {
        await markUnavailable(t.id, message);
        result.gone.push(t.title);
      } else {
        // A hiccup (network, rate limit): try again tomorrow, never mark on this.
        await db
          .update(tracks)
          .set({ checkedAt: new Date(now.getTime() - CHECK_EVERY_DAYS * 24 * 3600_000 + RETRY_AFTER_TRANSIENT_MS) })
          .where(eq(tracks.id, t.id));
        result.retry++;
      }
    }
  }
  return result;
}
