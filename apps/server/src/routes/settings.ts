import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, requireAdmin } from "../lib/auth.js";
import { getSettings, THEMES, updateSettings } from "../lib/settings.js";
import { zValidator } from "../lib/validate.js";

export const settingsBody = z.object({ defaultTheme: z.enum(THEMES) }).partial();

/** Everyone: what the page needs before sign-in (the default theme). */
export const settingsRoutes = new Hono<AppEnv>().get("/", async (c) => c.json(await getSettings()));

/** Admins: change radio-wide settings. */
export const adminSettingsRoutes = new Hono<AppEnv>()
  .use(requireAdmin)
  .patch("/", zValidator("json", settingsBody), async (c) => c.json(await updateSettings(c.req.valid("json"))));
