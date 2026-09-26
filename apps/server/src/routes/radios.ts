import { Hono } from "hono";
import { zValidator } from "../lib/validate.js";
import { z } from "zod";
import { and, asc, desc, eq, gt, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db, schema } from "../db/index.js";
import type { Radio } from "../db/schema.js";
import { type AppEnv, type PublicUser, requireAdmin, requireUser } from "../lib/auth.js";
import { probe, ProbeError } from "../lib/ytdlp.js";
import { knownFromUrl } from "../lib/search.js";
import { streamStatus } from "../lib/mediamtx.js";
import { heartbeat, isListening, listenerCount } from "../lib/listeners.js";
import { applyVotes, skipItem, skipState } from "../lib/skip.js";
import { hoursStatus, isValidTimezone } from "../lib/schedule.js";
import { songRecords } from "../lib/track-stats.js";

const { radios, queueItems, tracks, users, skipVotes } = schema;

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, "Use lowercase letters, digits and dashes");

const radioFields = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500),
  isActive: z.boolean(),
  rateLimitCount: z.number().int().min(1).max(1000),
  rateLimitWindowSec: z.number().int().min(10).max(7 * 24 * 3600),
  maxTrackSec: z.number().int().min(30).max(4 * 3600),
  skipVotePercent: z.number().int().min(0).max(100),
  hoursEnabled: z.boolean(),
  hoursDays: z
    .array(z.number().int().min(0).max(6))
    .min(1, "Pick at least one day")
    .transform((d) => [...new Set(d)].sort()),
  hoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
  hoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM"),
  timezone: z.string().refine(isValidTimezone, "Unknown timezone"),
  autofillBelowSec: z.number().int().min(0).max(4 * 3600),
};

const createRadioBody = z.object({ slug: slugSchema, ...radioFields }).partial({
  description: true,
  isActive: true,
  rateLimitCount: true,
  rateLimitWindowSec: true,
  maxTrackSec: true,
  skipVotePercent: true,
  hoursEnabled: true,
  hoursDays: true,
  hoursStart: true,
  hoursEnd: true,
  timezone: true,
  autofillBelowSec: true,
});
const updateRadioBody = z.object(radioFields).partial();

// A link or search pick (url), or a song this station knows already (trackId: "add again").
const pushBody = z.union([
  z.object({
    url: z
      .string()
      .trim()
      .url()
      .max(2000)
      .refine((u) => /^https?:\/\//i.test(u), "Only http(s) links"),
  }),
  z.object({ trackId: z.string().uuid() }),
]);

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

async function onAir(radioId: string) {
  const [row] = await db
    .select({ id: queueItems.id, userId: queueItems.userId })
    .from(queueItems)
    .where(and(eq(queueItems.radioId, radioId), eq(queueItems.status, "playing")))
    .limit(1);
  return row ?? null;
}

async function getRadio(slug: string): Promise<Radio> {
  const radio = await db.query.radios.findFirst({ where: eq(radios.slug, slug) });
  if (!radio) throw new HTTPException(404, { message: "No such radio" });
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

type Quota = {
  unlimited: boolean;
  limit: number;
  windowSec: number;
  used: number;
  remaining: number;
  nextSlotAt: string | null;
};

/** Sliding window: every push (even ones later removed) counts until it ages out. */
async function quotaFor(radio: Radio, user: PublicUser, tx: Pick<typeof db, "select"> = db): Promise<Quota> {
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

function publicRadio(r: Radio) {
  const { createdAt: _c, ...fields } = r;
  return { ...fields, hours: hoursStatus(r) };
}

async function resolveTrack(body: { url: string } | { trackId: string }) {
  if ("trackId" in body) {
    const t = await db.query.tracks.findFirst({ where: eq(tracks.id, body.trackId) });
    if (!t) throw new HTTPException(404, { message: "Unknown song" });
    const { id: _id, createdAt: _c, ...meta } = t;
    return meta;
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

// ---------------------------------------------------------------- routes

export const radioRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const isAdmin = c.get("user")?.role === "admin";
    const list = await db.query.radios.findMany({
      where: isAdmin ? undefined : eq(radios.isActive, true),
      orderBy: asc(radios.name),
    });
    const playing = await nowPlaying(list.map((r) => r.id));
    const queued = await db
      .select({ radioId: queueItems.radioId, count: sql<number>`count(*)::int` })
      .from(queueItems)
      .where(eq(queueItems.status, "queued"))
      .groupBy(queueItems.radioId);
    const queuedBy = new Map(queued.map((q) => [q.radioId, q.count]));
    return c.json({
      radios: list.map((r) => ({
        ...publicRadio(r),
        nowPlaying: playing.get(r.id) ?? null,
        queueLength: queuedBy.get(r.id) ?? 0,
        listeners: listenerCount(r.id),
      })),
    });
  })

  .post("/", requireAdmin, zValidator("json", createRadioBody), async (c) => {
    const body = c.req.valid("json");
    const [created] = await db.insert(radios).values(body).onConflictDoNothing().returning();
    if (!created) throw new HTTPException(409, { message: "That slug is taken" });
    return c.json({ radio: publicRadio(created) }, 201);
  })

  .get("/:slug", async (c) => {
    const radio = await getRadio(c.req.param("slug"));
    const user = c.get("user");
    if (!radio.isActive && user?.role !== "admin") throw new HTTPException(404, { message: "No such radio" });
    const [playing, queue, quota] = await Promise.all([
      nowPlaying([radio.id]),
      itemsQuery()
        .where(and(eq(queueItems.radioId, radio.id), eq(queueItems.status, "queued")))
        // Same order the broadcaster plays them: people's picks, then Alfred's.
        .orderBy(asc(queueItems.isFill), asc(queueItems.createdAt)),
      user ? quotaFor(radio, user) : null,
    ]);
    const current = playing.get(radio.id) ?? null;
    return c.json({
      radio: publicRadio(radio),
      nowPlaying: current,
      skip: await skipState(radio, current, user),
      queue,
      quota,
      serverTime: new Date().toISOString(),
    });
  })

  .patch("/:slug", requireAdmin, zValidator("json", updateRadioBody), async (c) => {
    const radio = await getRadio(c.req.param("slug"));
    const [updated] = await db.update(radios).set(c.req.valid("json")).where(eq(radios.id, radio.id)).returning();
    return c.json({ radio: publicRadio(updated) });
  })

  .get("/:slug/history", async (c) => {
    const radio = await getRadio(c.req.param("slug"));
    const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 30)));
    const items = await itemsQuery()
      .where(
        and(
          eq(queueItems.radioId, radio.id),
          inArray(queueItems.status, ["played", "skipped"]),
          isNotNull(queueItems.startedAt),
        ),
      )
      .orderBy(desc(queueItems.startedAt))
      .limit(limit);
    return c.json({ items });
  })

  .get("/:slug/stats", async (c) => {
    const radio = await getRadio(c.req.param("slug"));
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
    return c.json({ topPlayers, totals: { ...totals, downvotes } });
  })

  // Every song this station has aired, with plays, adds, downvotes and skips.
  .get(
    "/:slug/songs",
    zValidator("query", z.object({ sort: z.enum(["played", "score", "downvoted", "recent"]).default("played") })),
    async (c) => {
      const radio = await getRadio(c.req.param("slug"));
      return c.json({ songs: await songRecords(radio.id, c.req.valid("query").sort) });
    },
  )

  .get("/:slug/stream", async (c) => {
    const radio = await getRadio(c.req.param("slug"));
    const status = await streamStatus(radio.slug);
    return c.json({
      ...status,
      listeners: listenerCount(radio.id),
      hlsUrl: `/hls/${radio.slug}/index.m3u8`,
    });
  })

  .post("/:slug/listen", zValidator("json", z.object({ listenerId: z.string().min(8).max(64) })), async (c) => {
    const radio = await getRadio(c.req.param("slug"));
    heartbeat(radio.id, c.req.valid("json").listenerId, c.get("user")?.id ?? null);
    // Listeners leaving lowers the bar; votes already cast may now be enough.
    const current = await onAir(radio.id);
    if (current) await applyVotes(radio, current.id);
    return c.json({ listeners: listenerCount(radio.id) });
  })

  .post("/:slug/queue", requireUser, zValidator("json", pushBody), async (c) => {
    const user = c.get("user")!;
    const radio = await getRadio(c.req.param("slug"));
    if (!radio.isActive) throw new HTTPException(409, { message: "This radio is off the air" });

    // Cheap check first so rate-limited users don't trigger a slow yt-dlp probe.
    const pre = await quotaFor(radio, user);
    if (!pre.unlimited && pre.remaining === 0) throw quotaError(pre);

    const meta = await resolveTrack(c.req.valid("json"));
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
          set: {
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
    return c.json({ id: item.id, track: meta, position: ahead + 1, quota: await quotaFor(radio, user) }, 201);
  })

  .delete("/:slug/queue/:id", requireUser, async (c) => {
    const user = c.get("user")!;
    const radio = await getRadio(c.req.param("slug"));
    const conds = [
      eq(queueItems.id, c.req.param("id")),
      eq(queueItems.radioId, radio.id),
      eq(queueItems.status, "queued"),
    ];
    if (user.role !== "admin") conds.push(eq(queueItems.userId, user.id));
    const res = await db
      .update(queueItems)
      .set({ status: "removed", endedAt: new Date() })
      .where(and(...conds))
      .returning({ id: queueItems.id });
    if (!res.length) throw new HTTPException(404, { message: "Nothing to remove" });
    return c.json({ ok: true });
  })

  // Admins can skip anything; whoever added the song can skip their own.
  .post("/:slug/skip", requireUser, async (c) => {
    const user = c.get("user")!;
    const radio = await getRadio(c.req.param("slug"));
    const current = await onAir(radio.id);
    if (!current) return c.json({ skipped: false });
    const reason = user.role === "admin" ? "admin" : current.userId === user.id ? "owner" : null;
    if (!reason) throw new HTTPException(403, { message: "Only the person who added this song can skip it. Vote instead!" });
    return c.json({ skipped: await skipItem(current.id, reason) });
  })

  .post("/:slug/votes", requireUser, zValidator("json", z.object({ itemId: z.string().uuid() })), async (c) => {
    const user = c.get("user")!;
    const radio = await getRadio(c.req.param("slug"));
    if (radio.skipVotePercent <= 0) throw new HTTPException(409, { message: "Skip votes are off on this station" });
    const current = await onAir(radio.id);
    // Guard against voting on the next song because the page was a beat behind.
    if (!current || current.id !== c.req.valid("json").itemId) {
      throw new HTTPException(409, { message: "That song already ended" });
    }
    if (!isListening(radio.id, user.id)) throw new HTTPException(403, { message: "Tune in to vote" });
    await db.insert(skipVotes).values({ queueItemId: current.id, userId: user.id }).onConflictDoNothing();
    const skipped = await applyVotes(radio, current.id);
    return c.json({ skipped });
  })

  .delete("/:slug/votes/:itemId", requireUser, async (c) => {
    await db
      .delete(skipVotes)
      .where(and(eq(skipVotes.queueItemId, c.req.param("itemId")), eq(skipVotes.userId, c.get("user")!.id)));
    return c.json({ ok: true });
  });
