// Station business logic, shared by the REST routes (web app, API keys) and
// the MCP tools, so every rule (quotas, votes, ordering) lives in one place.
// Errors are HTTPExceptions with a message written for the listener.
import { and, asc, desc, eq, gt, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db, schema } from "../db/index.js";
import type { Radio } from "../db/schema.js";
import type { PublicUser } from "../lib/auth.js";
import { probe, ProbeError } from "../lib/ytdlp.js";
import { knownFromUrl } from "../lib/search.js";
import { isListening, listenerCount } from "../lib/listeners.js";
import { applyVotes, skipItem, skipState } from "../lib/skip.js";
import { hoursStatus } from "../lib/schedule.js";
import { canAccess, visibleTo } from "../lib/access.js";
import { myUpvotes, upvoteAllowance } from "../lib/upvotes.js";
import { offsetOf, pageOf, type Paging } from "../lib/paging.js";

const { radios, queueItems, tracks, users, skipVotes } = schema;

export type AddTarget = { url: string } | { trackId: string };

// ---------------------------------------------------------------- queries

const itemColumns = {
  id: queueItems.id,
  status: queueItems.status,
  skipReason: queueItems.skipReason,
  createdAt: queueItems.createdAt,
  startedAt: queueItems.startedAt,
  endedAt: queueItems.endedAt,
  track: {
    id: tracks.id,
    title: tracks.title,
    artist: tracks.artist,
    durationSec: tracks.durationSec,
    thumbnailUrl: tracks.thumbnailUrl,
    sourceUrl: tracks.sourceUrl,
    sourceKey: tracks.sourceKey,
    unavailable: sql<boolean>`${tracks.unavailableAt} is not null`,
    upvotes: sql<number>`(select count(*)::int from song_upvotes u where u.radio_id = ${queueItems.radioId} and u.track_id = ${tracks.id})`,
  },
  isFill: queueItems.isFill,
  // Null for Alfred's picks.
  pushedBy: { id: users.id, displayName: users.displayName },
};

const itemsQuery = () =>
  db
    .select(itemColumns)
    .from(queueItems)
    .innerJoin(tracks, eq(tracks.id, queueItems.trackId))
    .leftJoin(users, eq(users.id, queueItems.userId));

export async function onAir(radioId: string) {
  const [row] = await db
    .select({ id: queueItems.id, userId: queueItems.userId })
    .from(queueItems)
    .where(and(eq(queueItems.radioId, radioId), eq(queueItems.status, "playing")))
    .limit(1);
  return row ?? null;
}

export async function getRadio(slug: string): Promise<Radio> {
  const radio = await db.query.radios.findFirst({ where: eq(radios.slug, slug) });
  if (!radio) throw new HTTPException(404, { message: `No station called "${slug}"` });
  return radio;
}

async function nowPlaying(radioIds: string[]) {
  if (radioIds.length === 0) return new Map<string, Awaited<ReturnType<typeof itemsQuery>>[number]>();
  const rows = await db
    .select({ radioId: queueItems.radioId, ...itemColumns })
    .from(queueItems)
    .innerJoin(tracks, eq(tracks.id, queueItems.trackId))
    .leftJoin(users, eq(users.id, queueItems.userId))
    .where(and(inArray(queueItems.radioId, radioIds), eq(queueItems.status, "playing")));
  return new Map(rows.map(({ radioId, ...item }) => [radioId, item]));
}

export type Quota = {
  unlimited: boolean;
  limit: number;
  windowSec: number;
  used: number;
  remaining: number;
  nextSlotAt: string | null;
};

/** Sliding window: every push (even ones later removed) counts until it ages out. */
export async function quotaFor(radio: Radio, user: PublicUser, tx: Pick<typeof db, "select"> = db): Promise<Quota> {
  const windowStart = new Date(Date.now() - radio.rateLimitWindowSec * 1000);
  const rows = await tx
    .select({ createdAt: queueItems.createdAt })
    .from(queueItems)
    .where(
      and(
        eq(queueItems.radioId, radio.id),
        eq(queueItems.userId, user.id),
        gt(queueItems.createdAt, windowStart),
      ),
    )
    .orderBy(asc(queueItems.createdAt));
  const used = rows.length;
  const limit = radio.rateLimitCount;
  const blockedBy = used >= limit ? rows[used - limit] : null;
  return {
    unlimited: user.role === "admin",
    limit,
    windowSec: radio.rateLimitWindowSec,
    used,
    remaining: Math.max(0, limit - used),
    nextSlotAt: blockedBy
      ? new Date(blockedBy.createdAt.getTime() + radio.rateLimitWindowSec * 1000).toISOString()
      : null,
  };
}

function quotaError(q: Quota) {
  const wait = q.nextSlotAt ? Math.ceil((Date.parse(q.nextSlotAt) - Date.now()) / 1000) : 0;
  const mins = Math.max(1, Math.ceil(wait / 60));
  return new HTTPException(429, {
    message: `You've added your ${q.limit} songs for now. You can add another in ~${mins} min.`,
  });
}

export function publicRadio(r: Radio) {
  const { createdAt: _c, ...fields } = r;
  return { ...fields, hours: hoursStatus(r) };
}

async function resolveTrack(body: { url: string } | { trackId: string }) {
  if ("trackId" in body) {
    const t = await db.query.tracks.findFirst({ where: eq(tracks.id, body.trackId) });
    if (!t) throw new HTTPException(404, { message: "Unknown song" });
    if (t.unavailableAt) {
      throw new HTTPException(410, {
        message: `"${t.title}" is no longer available. Search for it by name to find another copy.`,
      });
    }
    const { sourceKey, sourceUrl, title, artist, durationSec, thumbnailUrl } = t;
    return { sourceKey, sourceUrl, title, artist, durationSec, thumbnailUrl };
  }
  const url = body.url;
  // Songs picked from our own search results are already known: add them instantly.
  const known = knownFromUrl(url);
  if (known) return known;
  try {
    return await probe(url);
  } catch (e) {
    if (e instanceof ProbeError) throw new HTTPException(422, { message: e.message });
    throw e;
  }
}

// ---------------------------------------------------------------- reads

/** The station, if this person may see it; otherwise it doesn't exist (404, no hint it's private). */
export async function getVisibleRadio(slug: string, user: PublicUser | null): Promise<Radio> {
  const radio = await getRadio(slug);
  const hidden = (!radio.isActive && user?.role !== "admin") || !(await canAccess(radio, user));
  if (hidden) throw new HTTPException(404, { message: `No station called "${slug}"` });
  return radio;
}

export async function listRadios(user: PublicUser | null) {
  const isAdmin = user?.role === "admin";
  const list = await db.query.radios.findMany({
    where: isAdmin ? undefined : and(eq(radios.isActive, true), visibleTo(user)),
    orderBy: asc(radios.name),
  });
  const playing = await nowPlaying(list.map((r) => r.id));
  const queued = await db
    .select({ radioId: queueItems.radioId, count: sql<number>`count(*)::int` })
    .from(queueItems)
    .where(eq(queueItems.status, "queued"))
    .groupBy(queueItems.radioId);
  const queuedBy = new Map(queued.map((q) => [q.radioId, q.count]));
  return list.map((r) => ({
    ...publicRadio(r),
    nowPlaying: playing.get(r.id) ?? null,
    queueLength: queuedBy.get(r.id) ?? 0,
    listeners: listenerCount(r.id),
  }));
}

const queuedHere = (radio: Radio) => and(eq(queueItems.radioId, radio.id), eq(queueItems.status, "queued"));
// Same order the broadcaster plays them: people's picks, then Alfred's.
const playOrder = [asc(queueItems.isFill), asc(queueItems.createdAt)] as const;

/** One page of what's lined up, in play order. */
export async function queuePage(radio: Radio, p: Paging) {
  const [items, summary] = await Promise.all([
    itemsQuery().where(queuedHere(radio)).orderBy(...playOrder).limit(p.pageSize).offset(offsetOf(p)),
    queueSummary(radio),
  ]);
  return { ...pageOf(items, summary.total, p), totalDurationSec: summary.totalDurationSec };
}

/** The whole queue (for the MCP's arrival times); bounded, queues are short in practice. */
export function fullQueue(radio: Radio) {
  return itemsQuery().where(queuedHere(radio)).orderBy(...playOrder).limit(500);
}

/** Size and length of the queue, and which songs are in it, without the rows themselves. */
export async function queueSummary(radio: Radio) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      totalDurationSec: sql<number>`coalesce(sum(${tracks.durationSec}), 0)::int`,
      keys: sql<string[]>`coalesce(array_agg(${tracks.sourceKey}), '{}')`,
    })
    .from(queueItems)
    .innerJoin(tracks, eq(tracks.id, queueItems.trackId))
    .where(queuedHere(radio));
  return row;
}

export async function radioDetail(radio: Radio, user: PublicUser | null) {
  const firstPage = { page: 1, pageSize: 20 };
  const [playing, queue, summary, quota, upvoted, upvoteLeft] = await Promise.all([
    nowPlaying([radio.id]),
    itemsQuery().where(queuedHere(radio)).orderBy(...playOrder).limit(firstPage.pageSize),
    queueSummary(radio),
    user ? quotaFor(radio, user) : null,
    myUpvotes(radio, user),
    user ? upvoteAllowance(user.id) : null,
  ]);
  const current = playing.get(radio.id) ?? null;
  return {
    radio: publicRadio(radio),
    nowPlaying: current,
    skip: await skipState(radio, current, user),
    // The first page only; the full list is paged via /queue.
    queue,
    queueTotal: summary.total,
    queueDurationSec: summary.totalDurationSec,
    // Everything lined up, so "already in line" checks see past the first page.
    queuedKeys: summary.keys,
    quota,
    // Track ids this person upvoted here, and how many upvotes they have left today.
    myUpvotes: upvoted,
    upvotes: upvoteLeft,
    listeners: listenerCount(radio.id),
    serverTime: new Date().toISOString(),
  };
}

export async function history(radio: Radio, p: Paging) {
  const aired = and(
    eq(queueItems.radioId, radio.id),
    inArray(queueItems.status, ["played", "skipped"]),
    isNotNull(queueItems.startedAt),
  );
  const [items, [{ total }]] = await Promise.all([
    itemsQuery().where(aired).orderBy(desc(queueItems.startedAt)).limit(p.pageSize).offset(offsetOf(p)),
    db.select({ total: sql<number>`count(*)::int` }).from(queueItems).where(aired),
  ]);
  return pageOf(items, total, p);
}

export async function stats(radio: Radio) {
  const aired = and(eq(queueItems.radioId, radio.id), isNotNull(queueItems.startedAt));
  const plays = sql<number>`count(*)::int`;
  const [topPlayers, [totals], [{ downvotes }]] = await Promise.all([
    db
      .select({
        user: { id: users.id, displayName: users.displayName },
        plays,
        listenedSec: sql<number>`coalesce(sum(${tracks.durationSec}), 0)::int`,
      })
      .from(queueItems)
      .innerJoin(users, eq(users.id, queueItems.userId))
      .innerJoin(tracks, eq(tracks.id, queueItems.trackId))
      .where(aired)
      .groupBy(users.id)
      .orderBy(desc(plays))
      .limit(10),
    db
      .select({
        plays,
        uniqueTracks: sql<number>`count(distinct ${queueItems.trackId})::int`,
        uniquePlayers: sql<number>`count(distinct ${queueItems.userId})::int`,
        airtimeSec: sql<number>`coalesce(sum(extract(epoch from (coalesce(${queueItems.endedAt}, now()) - ${queueItems.startedAt}))), 0)::int`,
      })
      .from(queueItems)
      .where(aired),
    db
      .select({ downvotes: sql<number>`count(*)::int` })
      .from(skipVotes)
      .innerJoin(queueItems, eq(queueItems.id, skipVotes.queueItemId))
      .where(eq(queueItems.radioId, radio.id)),
  ]);
  return { topPlayers, totals: { ...totals, downvotes } };
}

// ---------------------------------------------------------------- writes

/** Adds a song for `user`: quota, length, duplicate and Alfred-promotion rules apply. */
export async function addSong(radio: Radio, user: PublicUser, target: AddTarget) {
  if (!radio.isActive) throw new HTTPException(409, { message: "This station is off the air" });

  // Cheap check first so rate-limited users don't trigger a slow yt-dlp probe.
  const pre = await quotaFor(radio, user);
  if (!pre.unlimited && pre.remaining === 0) throw quotaError(pre);

  const meta = await resolveTrack(target);
  if (meta.durationSec != null && meta.durationSec > radio.maxTrackSec) {
    throw new HTTPException(422, {
      message: `That song is too long for this station (up to ${Math.round(radio.maxTrackSec / 60)} min)`,
    });
  }

  const item = await db.transaction(async (tx) => {
    // One push at a time per user and radio, so the quota re-check below is race-free.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`push:${user.id}:${radio.id}`}))`);
    const q = await quotaFor(radio, user, tx);
    if (!q.unlimited && q.remaining === 0) throw quotaError(q);

    const [track] = await tx
      .insert(tracks)
      .values(meta)
      .onConflictDoUpdate({
        target: tracks.sourceKey,
        // Freshly resolved, so it's evidently available again.
        set: {
          unavailableAt: null,
          unavailableReason: null,
          title: meta.title,
          artist: meta.artist,
          durationSec: meta.durationSec,
          thumbnailUrl: meta.thumbnailUrl,
          sourceUrl: meta.sourceUrl,
        },
      })
      .returning();

    const dup = await tx
      .select({ id: queueItems.id, isFill: queueItems.isFill, status: queueItems.status })
      .from(queueItems)
      .where(
        and(
          eq(queueItems.radioId, radio.id),
          eq(queueItems.trackId, track.id),
          inArray(queueItems.status, ["queued", "playing"]),
        ),
      )
      .limit(1);
    // Re-adding one of Alfred's queued picks makes it yours, so it moves up with people's songs.
    if (dup[0]?.isFill && dup[0].status === "queued") {
      await tx.update(queueItems).set({ status: "removed", endedAt: new Date() }).where(eq(queueItems.id, dup[0].id));
    } else if (dup.length) {
      throw new HTTPException(409, { message: "That song is already in line" });
    }

    const [created] = await tx
      .insert(queueItems)
      .values({ radioId: radio.id, trackId: track.id, userId: user.id })
      .returning({ id: queueItems.id, createdAt: queueItems.createdAt });
    return created;
  });

  const [{ ahead }] = await db
    .select({ ahead: sql<number>`count(*)::int` })
    .from(queueItems)
    .where(
      and(
        eq(queueItems.radioId, radio.id),
        eq(queueItems.status, "queued"),
        eq(queueItems.isFill, false),
        lt(queueItems.createdAt, item.createdAt),
      ),
    );
  return { id: item.id, track: meta, position: ahead + 1, quota: await quotaFor(radio, user) };
}


export async function removeQueued(radio: Radio, user: PublicUser, itemId: string) {
  const conds = [eq(queueItems.id, itemId), eq(queueItems.radioId, radio.id), eq(queueItems.status, "queued")];
  if (user.role !== "admin") conds.push(eq(queueItems.userId, user.id));
  const res = await db
    .update(queueItems)
    .set({ status: "removed", endedAt: new Date() })
    .where(and(...conds))
    .returning({ id: queueItems.id });
  if (!res.length) throw new HTTPException(404, { message: "Nothing to remove" });
}

/** Admins can skip anything; whoever added the song can skip their own. */
export async function skipCurrent(radio: Radio, user: PublicUser): Promise<boolean> {
  const current = await onAir(radio.id);
  if (!current) return false;
  const reason = user.role === "admin" ? "admin" : current.userId === user.id ? "owner" : null;
  if (!reason) {
    throw new HTTPException(403, { message: "Only the person who added this song can skip it. Vote instead!" });
  }
  return skipItem(current.id, reason);
}

/**
 * A downvote (skip vote) on the song on air. `itemId`, when given, must be
 * the song on air: it guards against voting on the next song by accident.
 */
export async function downvote(radio: Radio, user: PublicUser, itemId?: string) {
  if (radio.skipVotePercent <= 0) throw new HTTPException(409, { message: "Skip votes are off on this station" });
  const current = await onAir(radio.id);
  if (!current) throw new HTTPException(409, { message: "Nothing is playing right now" });
  if (itemId && current.id !== itemId) throw new HTTPException(409, { message: "That song already ended" });
  if (!isListening(radio.id, user.id)) {
    throw new HTTPException(403, { message: "Tune in to vote: only people listening to the station can downvote" });
  }
  await db.insert(skipVotes).values({ queueItemId: current.id, userId: user.id }).onConflictDoNothing();
  const skipped = await applyVotes(radio, current.id);
  return { skipped, itemId: current.id };
}

export async function undoDownvote(radio: Radio, user: PublicUser, itemId?: string) {
  const id = itemId ?? (await onAir(radio.id))?.id;
  if (!id) return;
  await db.delete(skipVotes).where(and(eq(skipVotes.queueItemId, id), eq(skipVotes.userId, user.id)));
}
