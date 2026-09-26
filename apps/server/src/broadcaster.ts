import { and, eq } from "drizzle-orm";
import { setTimeout as sleep } from "node:timers/promises";
import { db, schema } from "./db/index.js";
import { env } from "./lib/env.js";
import { AudioCache } from "./broadcaster/cache.js";
import { Channel } from "./broadcaster/channel.js";

const { radios, queueItems } = schema;

/** Anything still "playing" belongs to a channel that no longer exists. */
async function endOrphanedPlays(radioId?: string) {
  await db
    .update(queueItems)
    .set({ status: "skipped", skipReason: "interrupted", endedAt: new Date() })
    .where(
      radioId
        ? and(eq(queueItems.status, "playing"), eq(queueItems.radioId, radioId))
        : eq(queueItems.status, "playing"),
    );
}

async function main() {
  const cache = new AudioCache(env.CACHE_DIR, env.CACHE_MAX_BYTES);
  await cache.init();
  // The api container owns migrations; wait until the schema is there.
  for (;;) {
    try {
      await endOrphanedPlays();
      break;
    } catch (e) {
      console.log("waiting for database schema…", (e as Error).message);
      await sleep(2000);
    }
  }

  const channels = new Map<string, Channel>();

  // Deploys send SIGTERM: let every song on air finish first (compose allows
  // up to 25 minutes via stop_grace_period), then go. A second signal is final.
  let stopping = false;
  const shutdown = async () => {
    if (stopping) process.exit(0);
    stopping = true;
    console.log("shutting down after the songs on air finish…");
    await Promise.race([Promise.all([...channels.values()].map((ch) => ch.drain())), sleep(24 * 60_000)]);
    for (const ch of channels.values()) ch.stop();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Reconcile running channels with the radios table.
  for (;;) {
    if (stopping) {
      await sleep(1000);
      continue;
    }
    try {
      const active = await db
        .select({ id: radios.id, slug: radios.slug })
        .from(radios)
        .where(eq(radios.isActive, true));
      const wanted = new Map(active.map((r) => [r.id, r]));

      for (const [id, ch] of channels) {
        const r = wanted.get(id);
        if (!r || r.slug !== ch.radio.slug) {
          console.log(`stopping channel ${ch.radio.slug}`);
          ch.stop();
          channels.delete(id);
          await endOrphanedPlays(id);
        }
      }
      for (const r of active) {
        if (channels.has(r.id)) continue;
        console.log(`starting channel ${r.slug}`);
        const ch = new Channel(r, cache);
        channels.set(r.id, ch);
        ch.start();
      }
    } catch (e) {
      console.error("supervisor:", e);
    }
    await sleep(5000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
