import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./auth.js";
import { publicUrl } from "./public-url.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard for cookie sessions: a state-changing request carrying our
 * session cookie must come from our own pages. SameSite=Lax already stops
 * most of this; checking Origin closes the rest. Bearer-token requests are
 * not ambient, so they're exempt.
 */
export const sameOriginWrites = createMiddleware<AppEnv>(async (c, next) => {
  if (!SAFE.has(c.req.method) && c.get("auth")?.kind === "session") {
    const origin = c.req.header("origin");
    if (origin && origin !== publicUrl(c)) {
      throw new HTTPException(403, { message: "Cross-site request refused" });
    }
  }
  await next();
});
