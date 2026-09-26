import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, requireAdmin } from "../lib/auth.js";
import { listenerSeries, RANGES, type Range } from "../lib/listener-stats.js";
import { zValidator } from "../lib/validate.js";

export const listenersQuery = z.object({ range: z.enum(Object.keys(RANGES) as [Range, ...Range[]]).default("7d") });

/** Admins: how many people listened, over time. */
export const listenerStatsRoutes = new Hono<AppEnv>()
  .use(requireAdmin)
  .get("/", zValidator("query", listenersQuery), async (c) => c.json(await listenerSeries(c.req.valid("query").range)));
