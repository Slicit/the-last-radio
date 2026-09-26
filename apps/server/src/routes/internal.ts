import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, schema } from "../db/index.js";
import type { AppEnv } from "../lib/auth.js";
import { canAccess } from "../lib/access.js";

// Answers per (station, session) are cached briefly: players fetch a segment every ~2 s.
const TTL_MS = 20_000;
const cache = new Map<string, { ok: boolean; at: number }>();

/**
 * Called by nginx (auth_request) before serving any /hls/ file, so a private
 * station's audio is as private as its page. Not reachable from outside.
 */
export const internalRoutes = new Hono<AppEnv>().get("/hls-auth", async (c) => {
  const slug = (c.req.header("x-original-uri") ?? "").match(/^\/hls\/([a-z0-9-]+)\//)?.[1];
  if (!slug) return c.body(null, 403);
  const who = createHash("sha256").update(c.req.header("cookie") ?? "").digest("base64url");
  const key = `${slug}|${who}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return c.body(null, hit.ok ? 204 : 403);

  const radio = await db.query.radios.findFirst({ where: eq(schema.radios.slug, slug) });
  const user = c.get("user");
  const ok = !!radio && (radio.isActive || user?.role === "admin") && (await canAccess(radio, user));
  if (cache.size > 20_000) cache.clear();
  cache.set(key, { ok, at: Date.now() });
  return c.body(null, ok ? 204 : 403);
});
