import { z } from "zod";
import { db, schema } from "../db/index.js";

export const THEMES = ["night", "light", "vintage"] as const;
export type Theme = (typeof THEMES)[number];

/** Radio-wide settings, with their defaults. Unknown or invalid stored values fall back to these. */
export const settingsSchema = z.object({
  /** The theme guests see and new accounts start with. */
  defaultTheme: z.enum(THEMES).catch("night"),
});
export type Settings = z.infer<typeof settingsSchema>;

let cache: Settings | null = null;

/** The current settings (cached: there is one api process, and every write goes through here). */
export async function getSettings(): Promise<Settings> {
  if (cache) return cache;
  const rows = await db.select().from(schema.appSettings);
  cache = settingsSchema.parse(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  return cache;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    await db
      .insert(schema.appSettings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } });
  }
  cache = null;
  return getSettings();
}

/** Tests: forget the cached settings (the database is reset between tests). */
export const forgetSettings = () => void (cache = null);
