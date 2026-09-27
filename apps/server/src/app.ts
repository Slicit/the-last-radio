import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { type AppEnv, loadUser } from "./lib/auth.js";
import { legalInfo } from "./lib/legal.js";
import { openapiDocument } from "./lib/openapi.js";
import { publicUrl } from "./lib/public-url.js";
import { sameOriginWrites } from "./lib/origin-check.js";
import { rateLimit } from "./lib/rate-limit.js";
import { authRoutes } from "./routes/auth.js";
import { radioRoutes } from "./routes/radios.js";
import { userRoutes } from "./routes/users.js";
import { searchRoutes } from "./routes/search.js";
import { accessRoutes, oauthRoutes, wellKnownRoutes } from "./routes/oauth.js";
import { mcpRoutes } from "./routes/mcp.js";
import { adminFeedbackRoutes, feedbackRoutes } from "./routes/feedback.js";
import { avatarRoutes, meRoutes } from "./routes/me.js";
import { internalRoutes } from "./routes/internal.js";
import { stationAccessRoutes } from "./routes/access-admin.js";
import { listenerStatsRoutes } from "./routes/stats-admin.js";
import { adminSettingsRoutes, settingsRoutes } from "./routes/settings.js";

const smallBodies = bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "That request is too large" }, 413) });

/** The whole HTTP surface, without starting a server (tests call app.fetch directly). */
export function createApp({ log = true } = {}) {
  const api = new Hono<AppEnv>()
    .get("/health", (c) => c.json({ ok: true }))
    .get("/legal", (c) => c.json(legalInfo()))
    .get("/openapi.json", (c) => c.json(openapiDocument(publicUrl(c))))
    .route("/auth", authRoutes)
    .route("/radios", radioRoutes)
    .route("/users", userRoutes)
    .route("/search", searchRoutes)
    .route("/oauth", oauthRoutes)
    .route("/access", accessRoutes)
    .route("/feedback", feedbackRoutes)
    .route("/admin/feedback", adminFeedbackRoutes)
    .route("/admin/listeners", listenerStatsRoutes)
    .route("/settings", settingsRoutes)
    .route("/admin/settings", adminSettingsRoutes)
    .route("/me", meRoutes)
    .route("/avatars", avatarRoutes)
    .route("/radios", stationAccessRoutes)
    .route("/internal", internalRoutes);

  const app = new Hono<AppEnv>();
  if (log) app.use(logger());
  app
    // Nothing we accept is large; refuse big bodies before parsing them. The
    // avatar upload (5 MB) and station import (50 MB) set their own limits.
    .use(async (c, next) =>
      (c.req.method === "PUT" && c.req.path === "/api/me/avatar") ||
      (c.req.method === "POST" && c.req.path === "/api/radios/import")
        ? next()
        : smallBodies(c, next),
    )
    // A generous ceiling per IP across everything; routes add tighter ones.
    .use(rateLimit({ limit: 600, windowMs: 60_000, message: "Too many requests." }))
    .route("/.well-known", wellKnownRoutes)
    .use(loadUser)
    .use(sameOriginWrites)
    .route("/api", api)
    .route("/mcp", mcpRoutes);

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      // Keep headers set before the throw (Retry-After, WWW-Authenticate).
      return c.json({ error: err.message }, err.status);
    }
    console.error(err);
    return c.json({ error: "Internal error" }, 500);
  });
  app.notFound((c) => c.json({ error: "Not found" }, 404));
  return app;
}

export type AppType = ReturnType<typeof createApp>;
