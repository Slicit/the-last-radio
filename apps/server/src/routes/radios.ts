import { Hono } from "hono";
import { zValidator } from "../lib/validate.js";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db, schema } from "../db/index.js";
import { type AppEnv, requireAdmin, requireScope } from "../lib/auth.js";
import { streamStatus } from "../lib/mediamtx.js";
import { heartbeat, listenerCount } from "../lib/listeners.js";
import { clientIp, rateLimit } from "../lib/rate-limit.js";
import { applyVotes } from "../lib/skip.js";
import { isValidTimezone } from "../lib/schedule.js";
import { songCount, songRecords } from "../lib/track-stats.js";
import { offsetOf, pageOf, pagingQuery } from "../lib/paging.js";
import * as svc from "../services/radio.js";
import { removeUpvote, upvote } from "../lib/upvotes.js";
import { bodyLimit } from "hono/body-limit";
import { exportStation, importStation, stationFile } from "../lib/station-transfer.js";
import { stationTransferEnabled } from "../lib/features.js";
import { createMiddleware } from "hono/factory";

/** Export and import answer "not found" when the radio turned them off (STATION_TRANSFER=off). */
const transferOn = createMiddleware(async (_c, next) => {
  if (!stationTransferEnabled()) throw new HTTPException(404, { message: "Station export and import are turned off on this radio" });
  await next();
});

// A station's file can hold years of history; this is the one big JSON body we take.
export const IMPORT_MAX_BYTES = 50 * 1024 * 1024;

const { radios } = schema;

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, "Use lowercase letters, digits and dashes");

const radioFields = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500),
  isActive: z.boolean(),
  isPrivate: z.boolean(),
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

export const createRadioBody = z.object({ slug: slugSchema, ...radioFields }).partial({
  description: true,
  isActive: true,
  isPrivate: true,
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
export const updateRadioBody = z.object(radioFields).partial();

// A link or search pick (url), or a song this station knows already (trackId: "add again").
export const pushBody = z.union([
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

export const radioRoutes = new Hono<AppEnv>()
  .get("/", requireScope("radio:read"), async (c) => c.json({ radios: await svc.listRadios(c.get("user")) }))

  .post("/", requireAdmin, zValidator("json", createRadioBody), async (c) => {
    const [created] = await db.insert(radios).values(c.req.valid("json")).onConflictDoNothing().returning();
    if (!created) throw new HTTPException(409, { message: "That slug is taken" });
    return c.json({ radio: svc.publicRadio(created) }, 201);
  })

  // Recreate a station from an export file (see lib/station-transfer.ts).
  .post(
    "/import",
    transferOn,
    requireAdmin,
    bodyLimit({ maxSize: IMPORT_MAX_BYTES, onError: (c) => c.json({ error: "That file is over 50 MB" }, 413) }),
    zValidator("query", z.object({ slug: slugSchema.optional(), name: radioFields.name.optional() })),
    zValidator("json", stationFile),
    async (c) => {
      const file = c.req.valid("json");
      const q = c.req.valid("query");
      const slug = slugSchema.safeParse(q.slug ?? file.station.slug);
      if (!slug.success) throw new HTTPException(400, { message: "Choose a slug for the station" });
      const { radio, summary } = await importStation(file, { slug: slug.data, name: q.name });
      return c.json({ radio: svc.publicRadio(radio), summary }, 201);
    },
  )

  .get("/:slug/export", transferOn, requireAdmin, async (c) => {
    const radio = await svc.getRadio(c.req.param("slug"));
    const file = await exportStation(radio);
    const day = file.exportedAt.slice(0, 10);
    c.header("Content-Disposition", `attachment; filename="${radio.slug}-${day}.lastradio.json"`);
    c.header("Cache-Control", "no-store");
    return c.json(file);
  })

  .get("/:slug", requireScope("radio:read"), async (c) => {
    const user = c.get("user");
    const radio = await svc.getVisibleRadio(c.req.param("slug"), user);
    return c.json(await svc.radioDetail(radio, user));
  })

  .patch("/:slug", requireAdmin, zValidator("json", updateRadioBody), async (c) => {
    const radio = await svc.getRadio(c.req.param("slug"));
    const [updated] = await db.update(radios).set(c.req.valid("json")).where(eq(radios.id, radio.id)).returning();
    return c.json({ radio: svc.publicRadio(updated) });
  })

  .get("/:slug/queue", requireScope("radio:read"), zValidator("query", pagingQuery), async (c) =>
    c.json(await svc.queuePage(await svc.getVisibleRadio(c.req.param("slug"), c.get("user")), c.req.valid("query"))),
  )

  .get("/:slug/history", requireScope("radio:read"), zValidator("query", pagingQuery), async (c) =>
    c.json(await svc.history(await svc.getVisibleRadio(c.req.param("slug"), c.get("user")), c.req.valid("query"))),
  )

  .get("/:slug/stats", requireScope("radio:read"), async (c) => c.json(await svc.stats(await svc.getVisibleRadio(c.req.param("slug"), c.get("user")))))

  // Every song this station has aired, with plays, adds, downvotes and skips.
  .get(
    "/:slug/songs",
    requireScope("radio:read"),
    zValidator("query", pagingQuery.extend({ sort: z.enum(["played", "score", "downvoted", "recent"]).default("played") })),
    async (c) => {
      const radio = await svc.getVisibleRadio(c.req.param("slug"), c.get("user"));
      const q = c.req.valid("query");
      const [items, total] = await Promise.all([
        songRecords(radio.id, q.sort, q.pageSize, offsetOf(q)),
        songCount(radio.id),
      ]);
      return c.json(pageOf(items, total, q));
    },
  )

  .get("/:slug/stream", async (c) => {
    const radio = await svc.getVisibleRadio(c.req.param("slug"), c.get("user"));
    const status = await streamStatus(radio.slug);
    return c.json({ ...status, listeners: listenerCount(radio.id), hlsUrl: `/hls/${radio.slug}/index.m3u8` });
  })

  .post(
    "/:slug/listen",
    // Players beat every 20 s; this leaves room for a few tabs, not a flood.
    rateLimit({ limit: 30, windowMs: 60_000, message: "Too many heartbeats." }),
    zValidator("json", z.object({ listenerId: z.string().min(8).max(64) })),
    async (c) => {
    const radio = await svc.getVisibleRadio(c.req.param("slug"), c.get("user"));
    heartbeat(radio.id, c.req.valid("json").listenerId, c.get("user")?.id ?? null, clientIp(c));
    // Listeners leaving lowers the bar; votes already cast may now be enough.
    const current = await svc.onAir(radio.id);
    if (current) await applyVotes(radio, current.id);
    return c.json({ listeners: listenerCount(radio.id) });
  })

  .post("/:slug/queue", requireScope("radio:write"), zValidator("json", pushBody), async (c) => {
    const radio = await svc.getVisibleRadio(c.req.param("slug"), c.get("user"));
    return c.json(await svc.addSong(radio, c.get("user")!, c.req.valid("json")), 201);
  })

  .delete("/:slug/queue/:id", requireScope("radio:write"), async (c) => {
    await svc.removeQueued(await svc.getVisibleRadio(c.req.param("slug"), c.get("user")), c.get("user")!, c.req.param("id"));
    return c.json({ ok: true });
  })

  .post("/:slug/skip", requireScope("radio:write"), async (c) =>
    c.json({ skipped: await svc.skipCurrent(await svc.getVisibleRadio(c.req.param("slug"), c.get("user")), c.get("user")!) }),
  )

  .post("/:slug/votes", requireScope("radio:write"), zValidator("json", z.object({ itemId: z.string().uuid() })), async (c) => {
    const radio = await svc.getVisibleRadio(c.req.param("slug"), c.get("user"));
    const { skipped } = await svc.downvote(radio, c.get("user")!, c.req.valid("json").itemId);
    return c.json({ skipped });
  })

  .post("/:slug/upvotes", requireScope("radio:write"), zValidator("json", z.object({ trackId: z.string().uuid() })), async (c) => {
    const radio = await svc.getVisibleRadio(c.req.param("slug"), c.get("user"));
    return c.json(await upvote(radio, c.get("user")!, c.req.valid("json").trackId));
  })

  .delete("/:slug/upvotes/:trackId", requireScope("radio:write"), async (c) => {
    const radio = await svc.getVisibleRadio(c.req.param("slug"), c.get("user"));
    return c.json(await removeUpvote(radio, c.get("user")!, c.req.param("trackId")));
  })

  .delete("/:slug/votes/:itemId", requireScope("radio:write"), async (c) => {
    await svc.undoDownvote(await svc.getVisibleRadio(c.req.param("slug"), c.get("user")), c.get("user")!, c.req.param("itemId"));
    return c.json({ ok: true });
  });
