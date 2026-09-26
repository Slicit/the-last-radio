import { request, type FullConfig } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import postgres from "postgres";

export const ADMIN = { email: "admin@e2e.test", password: "admin-password-e2e", displayName: "Alex Admin" };
export const PLAYER = { email: "sam@e2e.test", password: "player-password-e2e", displayName: "Sam Player" };

async function account(baseURL: string, who: typeof ADMIN, statePath: string) {
  const ctx = await request.newContext({ baseURL });
  const reg = await ctx.post("/api/auth/register", { data: { ...who, acceptPrivacy: true } });
  if (reg.status() === 409) await ctx.post("/api/auth/login", { data: who }); // --keep reruns
  await ctx.storageState({ path: statePath });
  return ctx;
}

/**
 * The admin must be the stack's first account. Also creates the stations the
 * journeys use, and seeds play history (for Songs, Add again and Alfred) straight
 * into the test database, since that history otherwise takes hours of airtime.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  mkdirSync(".auth", { recursive: true });
  const admin = await account(baseURL, ADMIN, ".auth/admin.json");
  await account(baseURL, PLAYER, ".auth/player.json");

  // Live station for journeys that add real songs; Alfred off so the queue is ours.
  await admin.post("/api/radios", { data: { slug: "e2e-main", name: "E2E Main", autofillBelowSec: 0, rateLimitCount: 20 } });
  // Station holding seeded history. Closed by its hours (a one-minute window three
  // days away), so the broadcaster never plays or refills it, yet it's visible
  // and accepts songs like any station.
  const closedDay = (new Date().getUTCDay() + 3) % 7;
  await admin.post("/api/radios", {
    data: { slug: "e2e-records", name: "E2E Records", autofillBelowSec: 0, hoursEnabled: true, hoursDays: [closedDay], hoursStart: "12:00", hoursEnd: "12:01", timezone: "UTC" },
  });

  // Closed station with a long queue, for paging.
  await admin.post("/api/radios", {
    data: { slug: "e2e-paging", name: "E2E Paging", autofillBelowSec: 0, hoursEnabled: true, hoursDays: [closedDay], hoursStart: "12:00", hoursEnd: "12:01", timezone: "UTC" },
  });

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL (the test stack's database) is required for seeding");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [radio] = await sql`select id from radios where slug = 'e2e-records'`;
    const [sam] = await sql`select id from users where email = ${PLAYER.email}`;
    await sql`delete from queue_items where radio_id = ${radio.id}`;
    const [paging] = await sql`select id from radios where slug = 'e2e-paging'`;
    await sql`delete from queue_items where radio_id = ${paging.id}`;
    for (let i = 1; i <= 25; i++) {
      const key = `Youtube:e2ePage${String(i).padStart(4, "0")}`;
      const [t] = await sql`
        insert into tracks (source_key, source_url, title, artist, duration_sec)
        values (${key}, ${"https://www.youtube.com/watch?v=" + key.split(":")[1]}, ${`Paging Song ${String(i).padStart(2, "0")}`}, 'E2E Band', 180)
        on conflict (source_key) do update set title = excluded.title returning id`;
      await sql`insert into queue_items (radio_id, track_id, user_id, created_at)
        values (${paging.id}, ${t.id}, ${sam.id}, now() - make_interval(secs => ${100 - i}))`;
    }
    const songs = [
      { key: "Youtube:e2eFavourite1", title: "Crowd Favourite", plays: 3 },
      { key: "Youtube:e2eVotedOff01", title: "Voted Off Tune", plays: 1, votedOff: true },
      { key: "Youtube:e2eAlfredPk01", title: "Alfred Pick", plays: 1, alfredQueued: true },
      { key: "Youtube:e2eVanished01", title: "Vanished Hit (Official Video)", plays: 1, gone: true },
    ];
    for (const s of songs) {
      const [t] = await sql`
        insert into tracks (source_key, source_url, title, artist, duration_sec)
        values (${s.key}, ${"https://www.youtube.com/watch?v=" + s.key.split(":")[1]}, ${s.title}, 'E2E Band', 200)
        on conflict (source_key) do update set title = excluded.title returning id`;
      for (let i = 0; i < s.plays; i++) {
        await sql`insert into queue_items (radio_id, track_id, user_id, status, created_at, started_at, ended_at)
          values (${radio.id}, ${t.id}, ${sam.id}, 'played', now() - interval '5 hours', now() - interval '5 hours', now() - interval '5 hours')`;
      }
      if (s.votedOff) {
        await sql`insert into queue_items (radio_id, track_id, user_id, status, skip_reason, created_at, started_at, ended_at)
          values (${radio.id}, ${t.id}, ${sam.id}, 'skipped', 'votes', now() - interval '4 hours', now() - interval '4 hours', now() - interval '4 hours')`;
      }
      if ((s as { gone?: boolean }).gone) {
        await sql`update tracks set unavailable_at = now(), unavailable_reason = 'Video unavailable' where id = ${t.id}`;
      }
      if (s.alfredQueued) {
        await sql`insert into queue_items (radio_id, track_id, user_id, is_fill) values (${radio.id}, ${t.id}, null, true)`;
      }
    }
  } finally {
    await sql.end();
  }
  writeFileSync(".auth/accounts.json", JSON.stringify({ ADMIN, PLAYER }));
}
