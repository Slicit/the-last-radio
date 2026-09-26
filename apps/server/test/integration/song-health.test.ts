import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db/index.js";
import { checkSongs } from "../../src/lib/song-health.js";
import { alfredTopUp } from "../../src/lib/alfred.js";
import { ProbeError } from "../../src/lib/ytdlp.js";
import { add, createStation, register, track } from "./helpers.js";

const { tracks, queueItems, radios } = schema;
const row = async (id: string) => (await db.query.tracks.findFirst({ where: eq(tracks.id, id) }))!;

async function known(radioId: string, userId: string, over: Partial<typeof tracks.$inferInsert> = {}) {
  const t = await track(over);
  const at = new Date(Date.now() - 5 * 3600_000);
  await db.insert(queueItems).values({ radioId, trackId: t.id, userId, status: "played", startedAt: at, endedAt: at, createdAt: at });
  return t;
}

// specs/features/song-health.feature
describe("Song health check", () => {
  it("Songs are re-checked about once a week", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex);
    const never = await known(st.id, alex.user.id);
    const recent = await known(st.id, alex.user.id, { checkedAt: new Date(Date.now() - 2 * 86400_000) });
    const stale = await known(st.id, alex.user.id, { checkedAt: new Date(Date.now() - 8 * 86400_000) });
    const gone = await known(st.id, alex.user.id, { unavailableAt: new Date() });
    await track(); // known to no station: not our business
    const seen: string[] = [];
    const r = await checkSongs(async (url) => void seen.push(url));
    expect(r.checked).toBe(2);
    expect(seen.sort()).toEqual([never.sourceUrl, stale.sourceUrl].sort());
    expect((await row(never.id)).checkedAt).not.toBeNull();
    expect((await row(recent.id)).checkedAt!.getTime()).toBeLessThan(Date.now() - 86400_000);
    expect((await row(gone.id)).unavailableAt).not.toBeNull();
  });

  it("A song that's gone is marked unavailable", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex);
    const t = await known(st.id, alex.user.id, { title: "Vanished" });
    const r = await checkSongs(async () => {
      throw new ProbeError("[youtube] abc: Video unavailable");
    });
    expect(r.gone).toEqual(["Vanished"]);
    expect(await row(t.id)).toMatchObject({ unavailableReason: "[youtube] abc: Video unavailable" });
    const songs = await db.select().from(queueItems).where(eq(queueItems.trackId, t.id));
    expect(songs).toHaveLength(1); // history kept
  });

  it("A hiccup never marks a song", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex);
    const t = await known(st.id, alex.user.id);
    const r = await checkSongs(async () => {
      throw new ProbeError("HTTP Error 429: Too Many Requests");
    });
    expect(r.retry).toBe(1);
    const after = await row(t.id);
    expect(after.unavailableAt).toBeNull();
    // Due again in about a day, not a week.
    const dueIn = after.checkedAt!.getTime() + 7 * 86400_000 - Date.now();
    expect(dueIn).toBeGreaterThan(23 * 3600_000);
    expect(dueIn).toBeLessThan(25 * 3600_000);
  });

  it("Unavailable songs stay out of the way", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex, { autofillBelowSec: 3600 });
    const t = await known(st.id, alex.user.id, { title: "Gone Tune", unavailableAt: new Date() });
    await known(st.id, alex.user.id, { title: "Still Here" });
    const radio = (await db.query.radios.findFirst({ where: eq(radios.id, st.id) }))!;
    const picks = await alfredTopUp(radio);
    expect(picks.map((p) => p.replace(/ \(score .*\)$/, ""))).toEqual(["Still Here"]);
    const r = await add(alex, st.slug, t.id);
    expect(r.status).toBe(410);
    expect(r.json.error).toBe("\"Gone Tune\" is no longer available. Search for it by name to find another copy.");
  });
});
