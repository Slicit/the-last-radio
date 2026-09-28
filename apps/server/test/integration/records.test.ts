import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db/index.js";
import { add, call, createStation, register, track, listening, ORIGIN } from "./helpers.js";

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

// specs/features/song-records.feature
describe("Leaving people out of statistics", () => {
  it("People left out of statistics", async () => {
    const { sampleListeners } = await import("../../src/lib/listener-stats.js");
    const alex = await register("Alex"); // admin
    const sam = await register("Sam");
    const tess = await register("Tess Tester");
    const st = await createStation(alex);
    const song = await track({ title: "Shared tune" });
    const past = new Date(Date.now() - 3600_000);
    const aired = async (who: typeof sam) =>
      (
        await db
          .insert(queueItems)
          .values({ radioId: st.id, trackId: song.id, userId: who.user.id, status: "played", createdAt: past, startedAt: past, endedAt: past })
          .returning()
      )[0];
    await aired(sam);
    const tessItem = await aired(tess);
    await aired(tess);
    await db.insert(schema.skipVotes).values({ queueItemId: tessItem.id, userId: tess.user.id });
    await db.insert(schema.songUpvotes).values({ userId: tess.user.id, radioId: st.id, trackId: song.id });

    const record = async () => (await call("GET", `/api/radios/${st.slug}/songs`)).json.items[0];
    const stats = async () => (await call("GET", `/api/radios/${st.slug}/stats`)).json;
    expect(await record()).toMatchObject({ adders: 2, downvotes: 1, upvotes: 1 });
    expect((await stats()).topPlayers.map((p: any) => p.user.displayName)).toEqual(["Tess Tester", "Sam"]);
    const scoreBefore = (await record()).score;

    // Alex leaves Tess out of statistics.
    const r = await call("PATCH", `/api/users/${tess.user.id}`, { cookie: alex.cookie, origin: ORIGIN, body: { excludeFromStats: true } });
    expect(r.json.user.excludeFromStats).toBe(true);
    // Not ranked at all: Sam is first, not second behind a hidden Tess.
    expect((await stats()).topPlayers.map((p: any) => [p.user.displayName, p.plays])).toEqual([["Sam", 1]]);
    expect((await stats()).totals).toMatchObject({ uniquePlayers: 1, downvotes: 0, plays: 3 }); // the music still aired
    expect(await record()).toMatchObject({ adders: 1, downvotes: 0, upvotes: 0, plays: 3 });
    expect((await record()).score).toBeLessThan(scoreBefore); // Alfred no longer weighs Tess's adds and upvote

    // Nor counted as a listener in the charts (live counts stay, for skip votes).
    listening(st.id, "tess-listener-1", tess.user.id, "10.9.9.1");
    listening(st.id, "sam-listener-1", sam.user.id, "10.9.9.2");
    await sampleListeners(Date.now());
    const [sample] = await db.select().from(schema.listenerSamples).where(eq(schema.listenerSamples.radioId, st.id));
    expect(sample.listeners).toBe(1);

    // Admins see and change it in the people list; nobody else can.
    const people = (await call("GET", "/api/users?q=tess", { cookie: alex.cookie })).json.items;
    expect(people[0].excludeFromStats).toBe(true);
    expect((await call("PATCH", `/api/users/${sam.user.id}`, { cookie: sam.cookie, origin: ORIGIN, body: { excludeFromStats: true } })).status).toBe(403);
    // And back.
    await call("PATCH", `/api/users/${tess.user.id}`, { cookie: alex.cookie, origin: ORIGIN, body: { excludeFromStats: false } });
    expect(await record()).toMatchObject({ adders: 2, downvotes: 1, upvotes: 1 });
  });
});
