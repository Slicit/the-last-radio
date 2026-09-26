import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { type AppEnv, loadUser, purgeExpiredSessions } from "./lib/auth.js";
import { env } from "./lib/env.js";
import { runMigrations } from "./db/migrate.js";
import { authRoutes } from "./routes/auth.js";
import { radioRoutes } from "./routes/radios.js";
import { userRoutes } from "./routes/users.js";

const app = new Hono<AppEnv>()
  .basePath("/api")
  .use(logger())
  .use(loadUser)
  .get("/health", (c) => c.json({ ok: true }))
  .route("/auth", authRoutes)
  .route("/radios", radioRoutes)
  .route("/users", userRoutes);

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

await runMigrations();
setInterval(() => purgeExpiredSessions().catch(console.error), 3600_000);
serve({ fetch: app.fetch, port: env.PORT }, (info) => console.log(`api listening on :${info.port}`));

export type AppType = typeof app;
