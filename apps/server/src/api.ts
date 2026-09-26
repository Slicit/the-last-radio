import { serve } from "@hono/node-server";
import { purgeExpiredSessions } from "./lib/auth.js";
import { env } from "./lib/env.js";
import { runMigrations } from "./db/migrate.js";
import { createApp } from "./app.js";
import { startListenerSampling } from "./lib/listener-stats.js";

await runMigrations();
setInterval(() => purgeExpiredSessions().catch(console.error), 3600_000);
// Listener counts live in this process (heartbeats), so it's the one that records them.
startListenerSampling();
serve({ fetch: createApp().fetch, port: env.PORT }, (info) => console.log(`api listening on :${info.port}`));
