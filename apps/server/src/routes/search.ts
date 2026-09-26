import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { type AppEnv, requireScope, requireUser } from "../lib/auth.js";
import { SEARCH_SOURCES, searchSongs } from "../lib/search.js";
import { AbortedError, ProbeError } from "../lib/ytdlp.js";
import { zValidator } from "../lib/validate.js";

// Each search spawns yt-dlp, so cap how hard one person can hammer it.
const PER_MINUTE = 30;
const recent = new Map<string, number[]>();

function allow(userId: string): boolean {
  const cutoff = Date.now() - 60_000;
  const hits = (recent.get(userId) ?? []).filter((t) => t > cutoff);
  if (hits.length >= PER_MINUTE) return false;
  hits.push(Date.now());
  recent.set(userId, hits);
  return true;
}

export const searchRoutes = new Hono<AppEnv>().get(
  "/",
  requireUser,
  requireScope("radio:read"),
  zValidator("query", z.object({ q: z.string().trim().min(2).max(120), source: z.enum(SEARCH_SOURCES).default("youtube") })),
  async (c) => {
    if (!allow(c.get("user")!.id)) {
      throw new HTTPException(429, { message: "Searching a bit fast, give it a second" });
    }
    try {
      const { q, source } = c.req.valid("query");
      const results = await searchSongs(q, source, c.req.raw.signal);
      return c.json({ results });
    } catch (e) {
      if (e instanceof AbortedError) return c.body(null, 204);
      if (e instanceof ProbeError) throw new HTTPException(502, { message: "Search is unavailable right now" });
      throw e;
    }
  },
);
