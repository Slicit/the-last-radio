import { Hono } from "hono";
import type { AppEnv } from "../lib/auth.js";
import { artFor } from "../lib/art-cache.js";

/**
 * Song artwork from our own cache: GET /api/art/<source key>, e.g.
 * /api/art/Youtube%3AdQw4w9WgXcQ. 404 means "no image": the page shows its placeholder.
 */
export const artRoutes = new Hono<AppEnv>().get("/:key", async (c) => {
  const key = c.req.param("key");
  if (key.length > 300) return c.body(null, 404);
  const image = await artFor(key);
  if (!image) {
    c.header("Cache-Control", "public, max-age=300");
    return c.body(null, 404);
  }
  c.header("Content-Type", "image/webp");
  c.header("Cache-Control", "public, max-age=604800");
  c.header("X-Content-Type-Options", "nosniff");
  return c.body(new Uint8Array(image));
});
