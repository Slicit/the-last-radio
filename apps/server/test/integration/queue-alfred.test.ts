import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db/index.js";
import { alfredTopUp } from "../../src/lib/alfred.js";
import { add, call, createStation, register, track, type Person } from "./helpers.js";

const { queueItems, radios } = schema;

async function radioRow(id: string) {
  return (await db.query.radios.findFirst({ where: eq(radios.id, id) }))!;
}

/** Past airings: `plays` played to the end by `who`, `hoursAgo` ago. */
async function history(radioId: string, trackId: string, who: Person | null, opts: { plays?: number; outcome?: "played" | "skipped"; skipReason?: "votes" | "admin"; hoursAgo?: number } = {}) {
  const at = new Date(Date.now() - (opts.hoursAgo ?? 5) * 3600_000);
  for (let i = 0; i < (opts.plays ?? 1); i++) {
    await db.insert(queueItems).values({
      radioId,
      trackId,
      userId: who?.user.id ?? null,
      isFill: !who,
      status: opts.outcome ?? "played",
      skipReason: opts.skipReason ?? null,
      createdAt: at,
      startedAt: at,
      endedAt: at,
    });
  }
}

const queued = async (slug: string) => (await call("GET", `/api/radios/${slug}`)).json.queue as any[];

// specs/features/queue-and-alfred.feature
describe("Queue order and Alfred", () => {
  it("People's songs play before Alfred's", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex);
    const [a, b, mine] = [await track(), await track(), await track()];
    await db.insert(queueItems).values([
      { radioId: st.id, trackId: a.id, userId: null, isFill: true },
      { radioId: st.id, trackId: b.id, userId: null, isFill: true },
    ]);
    const r = await add(alex, st.slug, mine.id);
    expect(r.json.position).toBe(1);
    const q = await queued(st.slug);
    expect(q.map((i) => i.track.id)).toEqual([mine.id, a.id, b.id]);
    expect(q.map((i) => i.isFill)).toEqual([false, true, true]);
  });

  it("Re-adding one of Alfred's picks makes it yours", async () => {
    const alex = await register("Alex");
    const sam = await register("Sam");
    const st = await createStation(alex);
    const other = await track();
    const atw = await track({ title: "Around the World" });
    await db.insert(queueItems).values({ radioId: st.id, trackId: atw.id, userId: null, isFill: true });
    await add(alex, st.slug, other.id);
    const r = await add(sam, st.slug, atw.id);
    expect(r.status).toBe(201);
    const q = await queued(st.slug);
    expect(q.map((i) => [i.track.title, i.pushedBy?.id ?? "alfred"])).toEqual([
      [other.title, alex.user.id],
      ["Around the World", sam.user.id],
    ]);
  });

  it("Alfred fills the queue below the threshold", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex, { autofillBelowSec: 900 });
    for (let i = 0; i < 8; i++) await history(st.id, (await track({ durationSec: 240 })).id, alex);
    const picks = await alfredTopUp(await radioRow(st.id));
    expect(picks.length).toBe(4); // 4 × 240 s = 16 min ≥ 15 min
    const q = await queued(st.slug);
    expect(q.every((i) => i.isFill && i.pushedBy === null)).toBe(true);
    expect(await alfredTopUp(await radioRow(st.id))).toEqual([]); // already enough
  });

  it("adds at most 5 songs at a time", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex, { autofillBelowSec: 3600 });
    for (let i = 0; i < 10; i++) await history(st.id, (await track({ durationSec: 60 })).id, alex);
    expect((await alfredTopUp(await radioRow(st.id))).length).toBe(5);
  });

  it("Alfred leaves some songs alone", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex, { autofillBelowSec: 3600, maxTrackSec: 600 });
    const good = await track({ title: "Good" });
    const votedOff = await track({ title: "Voted off" });
    const adminSkipped = await track({ title: "Admin skipped" });
    const recent = await track({ title: "Recent" });
    const tooLong = await track({ title: "Too long", durationSec: 900 });
    const disliked = await track({ title: "Disliked" });
    await history(st.id, good.id, alex, { plays: 2 });
    await history(st.id, votedOff.id, alex, { plays: 3, hoursAgo: 10 });
    await history(st.id, votedOff.id, alex, { outcome: "skipped", skipReason: "votes", hoursAgo: 5 });
    await history(st.id, adminSkipped.id, alex, { outcome: "skipped", skipReason: "admin" });
    await history(st.id, recent.id, alex, { hoursAgo: 0.25 });
    await history(st.id, tooLong.id, alex);
    // "Disliked": played once by Alfred, then 3 downvotes on that airing → negative score.
    await history(st.id, disliked.id, null);
    const [airing] = await db.select().from(queueItems).where(eq(queueItems.trackId, disliked.id));
    for (const who of [await register("V1"), await register("V2"), await register("V3")]) {
      await db.insert(schema.skipVotes).values({ queueItemId: airing.id, userId: who.user.id });
    }
    const picks = await alfredTopUp(await radioRow(st.id));
    expect(picks.map((p) => p.replace(/ \(score .*\)$/, ""))).toEqual(["Good"]);
  });

  it("songs from the last few hours stay possible when nothing else is left", async () => {
    // Regression: a small library all played within 3 hours left Alfred with nothing to pick.
    const alex = await register("Alex");
    const st = await createStation(alex, { autofillBelowSec: 900 });
    for (let i = 0; i < 6; i++) await history(st.id, (await track({ durationSec: 240 })).id, alex, { hoursAgo: 1 });
    expect((await alfredTopUp(await radioRow(st.id))).length).toBe(4);
  });

  it("prefers songs that haven't played for a while", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex, { autofillBelowSec: 100 });
    const old = await track({ title: "Old favourite", durationSec: 200 });
    const fresh = await track({ title: "Just played", durationSec: 200 });
    await history(st.id, old.id, alex, { hoursAgo: 5 });
    await history(st.id, fresh.id, alex, { hoursAgo: 0.6 });
    let oldWins = 0;
    for (let i = 0; i < 40; i++) {
      const [pick] = await alfredTopUp(await radioRow(st.id));
      if (pick.startsWith("Old favourite")) oldWins++;
      await db.delete(queueItems).where(eq(queueItems.isFill, true));
    }
    // Freshness: 1 vs 0.2, so the old favourite wins ~83% of draws.
    expect(oldWins).toBeGreaterThan(25);
  });

  it("never queues two uploads of the same song", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex, { autofillBelowSec: 3600 });
    await history(st.id, (await track({ title: "AIR - Sexy Boy (Official Audio)" })).id, alex);
    await history(st.id, (await track({ title: "AIR - Sexy Boy [Remastered]" })).id, alex);
    await history(st.id, (await track({ title: "Something Else" })).id, alex);
    const picks = (await alfredTopUp(await radioRow(st.id))).map((p) => p.replace(/ \(score .*\)$/, ""));
    expect(picks.filter((p) => p.startsWith("AIR - Sexy Boy"))).toHaveLength(1);
    expect(picks).toHaveLength(2);
  });

  it("Alfred rests when turned off", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex, { autofillBelowSec: 0 });
    await history(st.id, (await track()).id, alex);
    expect(await alfredTopUp(await radioRow(st.id))).toEqual([]);
  });
});
