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
import { heartbeat, listenerCount } from "../lib/listeners.js";

const { radios, queueItems, tracks, users } = schema;

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
};

const createRadioBody = z.object({ slug: slugSchema, ...radioFields }).partial({
  description: true,
  isActive: true,
  rateLimitCount: true,
  rateLimitWindowSec: true,
  maxTrackSec: true,
});
const updateRadioBody = z.object(radioFields).partial();

const pushBody = z.object({
  url: z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u), "Only http(s) links"),
});

// ---------------------------------------------------------------- queries

const itemColumns = {
  id: queueItems.id,
  status: queueItems.status,
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
  pushedBy: { id: users.id, displayName: users.displayName },
};

const itemsQuery = () =>
  db
    .select(itemColumns)
    .from(queueItems)
    .innerJoin(tracks, eq(tracks.id, queueItems.trackId))
    .innerJoin(users, eq(users.id, queueItems.userId));

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
    .innerJoin(users, eq(users.id, queueItems.userId))
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
    message: `You've used your ${q.limit} pushes for this window. Next slot in ~${mins} min.`,
  });
}

function publicRadio(r: Radio) {
  const { id, slug, name, description, isActive, rateLimitCount, rateLimitWindowSec, maxTrackSec } = r;
  return { id, slug, name, description, isActive, rateLimitCount, rateLimitWindowSec, maxTrackSec };
}

async function resolveTrack(url: string) {
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
        .orderBy(asc(queueItems.createdAt)),
      user ? quotaFor(radio, user) : null,
    ]);
    return c.json({
      radio: publicRadio(radio),
      nowPlaying: playing.get(radio.id) ?? null,
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

    const [topTracks, topPlayers, [totals]] = await Promise.all([
      db
        .select({
          track: {
            id: tracks.id,
            title: tracks.title,
            artist: tracks.artist,
            thumbnailUrl: tracks.thumbnailUrl,
            sourceUrl: tracks.sourceUrl,
          },
          plays,
          lastPlayedAt: sql`max(${queueItems.startedAt})`.mapWith(queueItems.startedAt),
        })
        .from(queueItems)
        .innerJoin(tracks, eq(tracks.id, queueItems.trackId))
        .where(aired)
        .groupBy(tracks.id)
        .orderBy(desc(plays), desc(sql`max(${queueItems.startedAt})`))
        .limit(10),
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
    ]);
    return c.json({ topTracks, topPlayers, totals });
  })

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
    heartbeat(radio.id, c.req.valid("json").listenerId);
    return c.json({ listeners: listenerCount(radio.id) });
  })

  .post("/:slug/queue", requireUser, zValidator("json", pushBody), async (c) => {
    const user = c.get("user")!;
    const radio = await getRadio(c.req.param("slug"));
    if (!radio.isActive) throw new HTTPException(409, { message: "This radio is off the air" });

    // Cheap check first so rate-limited users don't trigger a slow yt-dlp probe.
    const pre = await quotaFor(radio, user);
    if (!pre.unlimited && pre.remaining === 0) throw quotaError(pre);

    const meta = await resolveTrack(c.req.valid("json").url);
    if (meta.durationSec != null && meta.durationSec > radio.maxTrackSec) {
      throw new HTTPException(422, {
        message: `Too long: this radio accepts tracks up to ${Math.round(radio.maxTrackSec / 60)} min`,
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
        .select({ id: queueItems.id })
        .from(queueItems)
        .where(
          and(
            eq(queueItems.radioId, radio.id),
            eq(queueItems.trackId, track.id),
            inArray(queueItems.status, ["queued", "playing"]),
          ),
        )
        .limit(1);
      if (dup.length) throw new HTTPException(409, { message: "That track is already in the playlist" });

      const [created] = await tx
        .insert(queueItems)
        .values({ radioId: radio.id, trackId: track.id, userId: user.id })
        .returning({ id: queueItems.id, createdAt: queueItems.createdAt });
      return created;
    });

    const [{ ahead }] = await db
      .select({ ahead: sql<number>`count(*)::int` })
      .from(queueItems)
      .where(and(eq(queueItems.radioId, radio.id), eq(queueItems.status, "queued"), lt(queueItems.createdAt, item.createdAt)));
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

  .post("/:slug/skip", requireAdmin, async (c) => {
    const radio = await getRadio(c.req.param("slug"));
    // The broadcaster polls its on-air item and cuts the audio when it sees this.
    const res = await db
      .update(queueItems)
      .set({ status: "skipped", endedAt: new Date() })
      .where(and(eq(queueItems.radioId, radio.id), eq(queueItems.status, "playing")))
      .returning({ id: queueItems.id });
    return c.json({ skipped: res.length > 0 });
  });
