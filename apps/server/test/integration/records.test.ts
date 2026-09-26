import { describe, expect, it } from "vitest";
import { db, schema } from "../../src/db/index.js";
import { add, call, createStation, register, track } from "./helpers.js";

const { queueItems, skipVotes } = schema;

// specs/features/song-records.feature
describe("Song records", () => {
  it("A song's record", async () => {
    const alex = await register("Alex");
    const sam = await register("Sam");
    const st = await createStation(alex);
    const t = await track({ title: "Human After All" });
    const at = new Date(Date.now() - 3600_000);
    const [played, skipped] = await db
      .insert(queueItems)
      .values([
        { radioId: st.id, trackId: t.id, userId: sam.user.id, status: "played", startedAt: at, endedAt: at },
        { radioId: st.id, trackId: t.id, userId: alex.user.id, status: "skipped", skipReason: "votes", startedAt: at, endedAt: at },
        { radioId: st.id, trackId: t.id, userId: null, isFill: true, status: "played", startedAt: at, endedAt: at },
      ])
      .returning();
    await db.insert(skipVotes).values([
      { queueItemId: played.id, userId: alex.user.id }, // downvoted but not skipped
      { queueItemId: skipped.id, userId: sam.user.id },
    ]);
    const songs = (await call("GET", `/api/radios/${st.slug}/songs?sort=played`)).json.items;
    expect(songs[0]).toMatchObject({
      plays: 2,
      playsByPeople: 1,
      playsByAlfred: 1,
      airings: 3,
      adders: 2,
      downvotes: 2,
      skips: 1,
      lastOutcome: expect.any(String),
      // 1 + 0.5 + 2×2 − 2 − 3×1
      score: 0.5,
    });
  });

  it("Top players count people only", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex);
    const at = new Date();
    await db.insert(queueItems).values([
      { radioId: st.id, trackId: (await track()).id, userId: alex.user.id, status: "played", startedAt: at },
      { radioId: st.id, trackId: (await track()).id, userId: null, isFill: true, status: "played", startedAt: at },
    ]);
    const stats = (await call("GET", `/api/radios/${st.slug}/stats`)).json;
    expect(stats.topPlayers.map((p: any) => p.user.id)).toEqual([alex.user.id]);
    expect(stats.totals.plays).toBe(2);
  });

  it("Adding a song again", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex);
    const t = await track();
    await db.insert(queueItems).values({ radioId: st.id, trackId: t.id, userId: alex.user.id, status: "played", startedAt: new Date() });
    expect((await add(alex, st.slug, t.id)).status).toBe(201);
    expect((await add(alex, st.slug, t.id)).json.error).toBe("That song is already in line");
    expect((await call("POST", `/api/radios/${st.slug}/queue`, { cookie: alex.cookie, body: { trackId: "00000000-0000-4000-8000-000000000000" } })).status).toBe(404);
  });
});
