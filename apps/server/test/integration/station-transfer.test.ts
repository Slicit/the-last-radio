import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db/index.js";
import { call, createStation, ORIGIN, register, track, type Person } from "./helpers.js";

const { queueItems, skipVotes, songUpvotes, users, tracks } = schema;

/** A station with a bit of everything: plays by people and Alfred, a skip, downvotes, upvotes, a queue, access rules. */
async function busyStation(alex: Person, sam: Person) {
  const st = await createStation(alex, { isPrivate: true, rateLimitCount: 7, hoursEnabled: true, hoursDays: [5, 6], hoursStart: "22:00", hoursEnd: "02:00" });
  const [a, b, c] = [await track({ title: "Alpha" }), await track({ title: "Bravo" }), await track({ title: "Charlie" })];
  const at = (h: number) => new Date(Date.now() - h * 3600_000);
  const [, p2] = await db
    .insert(queueItems)
    .values([
      { radioId: st.id, trackId: a.id, userId: sam.user.id, status: "played", createdAt: at(5), startedAt: at(5), endedAt: at(4.9) },
      { radioId: st.id, trackId: b.id, userId: null, isFill: true, status: "skipped", skipReason: "votes", createdAt: at(4), startedAt: at(4), endedAt: at(3.99) },
      { radioId: st.id, trackId: a.id, userId: alex.user.id, status: "played", createdAt: at(3), startedAt: at(3), endedAt: at(2.9) },
      { radioId: st.id, trackId: c.id, userId: sam.user.id, status: "queued", createdAt: at(0.1) },
    ])
    .returning();
  await db.insert(skipVotes).values([{ queueItemId: p2.id, userId: sam.user.id }, { queueItemId: p2.id, userId: alex.user.id }]);
  await db.insert(songUpvotes).values({ userId: sam.user.id, radioId: st.id, trackId: a.id });
  await call("POST", `/api/radios/${st.slug}/members`, { cookie: alex.cookie, origin: ORIGIN, body: { email: sam.email } });
  await call("POST", `/api/radios/${st.slug}/domains`, { cookie: alex.cookie, origin: ORIGIN, body: { domain: "example.org" } });
  return st;
}

const exportOf = async (admin: Person, slug: string) => call("GET", `/api/radios/${slug}/export`, { cookie: admin.cookie });
const importAs = (admin: Person, file: unknown, query = "") =>
  call("POST", `/api/radios/import${query}`, { cookie: admin.cookie, origin: ORIGIN, body: file });

/** What people see of a station's records, without ids. */
async function records(who: Person, slug: string) {
  const songs = (await call("GET", `/api/radios/${slug}/songs?pageSize=100`, { cookie: who.cookie })).json.items;
  const history = (await call("GET", `/api/radios/${slug}/history?pageSize=100`, { cookie: who.cookie })).json.items;
  const queue = (await call("GET", `/api/radios/${slug}/queue`, { cookie: who.cookie })).json.items;
  const stats = (await call("GET", `/api/radios/${slug}/stats`, { cookie: who.cookie })).json;
  const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === "id" || k === "trackId" ? undefined : v)));
  return strip({ songs, history, queue: queue.map((q: any) => ({ title: q.track.title, by: q.pushedBy?.displayName })), stats });
}

// specs/features/station-transfer.feature
describe("Moving a station", () => {
  it("Exporting a station", async () => {
    const alex = await register("Alex");
    const sam = await register("Sam");
    const st = await busyStation(alex, sam);
    const r = await exportOf(alex, st.slug);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toMatch(new RegExp(`attachment; filename="${st.slug}-\\d{4}-\\d{2}-\\d{2}\\.lastradio\\.json"`));
    const f = r.json;
    expect(f).toMatchObject({
      format: "the-last-radio.station",
      version: 1,
      station: { slug: st.slug, isPrivate: true, rateLimitCount: 7, hoursEnabled: true, hoursDays: [5, 6], hoursStart: "22:00", hoursEnd: "02:00" },
      access: { domains: ["example.org"] },
    });
    expect(f.people).toEqual(
      expect.arrayContaining([
        { ref: expect.any(String), email: sam.email, displayName: "Sam" },
        { ref: expect.any(String), email: alex.email, displayName: "Alex" },
      ]),
    );
    const ref = (email: string) => f.people.find((p: any) => p.email === email).ref;
    expect(f.access.members).toEqual([ref(sam.email)]);
    expect(f.songs.map((s: any) => s.title)).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(f.plays.map((p: any) => [p.status, p.by, p.isFill])).toEqual([
      ["played", ref(sam.email), false],
      ["skipped", null, true],
      ["played", ref(alex.email), false],
      ["queued", ref(sam.email), false],
    ]);
    expect(f.plays[1].skipReason).toBe("votes");
    expect(f.plays[1].downvotes.map((v: any) => v.by).sort()).toEqual([ref(sam.email), ref(alex.email)].sort());
    expect(f.upvotes).toEqual([{ song: "s1", by: ref(sam.email), at: expect.any(String) }]);

    // Admins only, and only from the website.
    expect((await exportOf(sam, st.slug)).status).toBe(403);
    expect((await call("GET", `/api/radios/${st.slug}/export`)).status).toBe(401);
  });

  it("Importing a station", async () => {
    const alex = await register("Alex");
    const sam = await register("Sam");
    const st = await busyStation(alex, sam);
    const file = (await exportOf(alex, st.slug)).json;
    const r = await importAs(alex, file, "?slug=moved&name=Moved%20here");
    expect(r.status).toBe(201);
    expect(r.json.radio).toMatchObject({ slug: "moved", name: "Moved here", isPrivate: true, rateLimitCount: 7, hoursDays: [5, 6] });
    expect(r.json.summary).toEqual({ songs: 3, newSongs: 0, plays: 3, queued: 1, people: { matched: 2, placeholders: 0 }, downvotes: 2, upvotes: 1 });
    expect(await records(alex, "moved")).toEqual(await records(alex, st.slug));
    const access = (await call("GET", "/api/radios/moved/access", { cookie: alex.cookie })).json;
    expect(access.members.map((m: any) => m.email)).toEqual([sam.email]);
    expect(access.domains).toEqual(["example.org"]);
    // Without a slug, the file's own is used (taken here).
    expect((await importAs(alex, file)).status).toBe(409);
  });

  it("People are matched by email", async () => {
    const alex = await register("Alex");
    const sam = await register("Sam");
    const robin = await register("Robin");
    const st = await createStation(alex);
    const t = await track({ title: "Shared" });
    const past = new Date(Date.now() - 3600_000);
    for (const who of [sam, robin]) {
      await db.insert(queueItems).values({ radioId: st.id, trackId: t.id, userId: who.user.id, status: "played", createdAt: past, startedAt: past, endedAt: past });
    }
    await db.insert(songUpvotes).values({ userId: robin.user.id, radioId: st.id, trackId: t.id });
    const file = (await exportOf(alex, st.slug)).json;
    // On the other radio, Robin has no account; and someone deleted theirs before the export.
    file.people.find((p: any) => p.email === robin.email).email = "robin@elsewhere.example";
    file.people.push({ ref: "p99", email: null, displayName: "Former listener" });
    file.plays.push({ ...file.plays[0], by: "p99", downvotes: [] });

    const r = await importAs(alex, file, "?slug=matched");
    expect(r.json.summary.people).toEqual({ matched: 1, placeholders: 2 });
    const items = await db.select().from(queueItems).where(eq(queueItems.radioId, r.json.radio.id));
    const owners = await Promise.all(items.map(async (i) => (await db.select().from(users).where(eq(users.id, i.userId!)))[0]));
    expect(owners.map((u) => u.displayName).sort()).toEqual(["Former listener", "Robin", "Sam"]);
    expect(owners.find((u) => u.displayName === "Sam")!.id).toBe(sam.user.id);
    const ghost = owners.find((u) => u.displayName === "Robin")!;
    expect(ghost.id).not.toBe(robin.user.id);
    expect(ghost.email).toMatch(/@imported\.invalid$/);
    expect(ghost.deletedAt).not.toBeNull();
    expect(ghost.passwordHash).toBe("!");
    const [ghostUpvote] = await db.select().from(songUpvotes).where(eq(songUpvotes.radioId, r.json.radio.id));
    expect(ghostUpvote.userId).toBe(ghost.id);
    // Nobody can sign in as a placeholder.
    const login = await call("POST", "/api/auth/login", { body: { email: ghost.email, password: "!" } });
    expect(login.status).toBeGreaterThanOrEqual(400);
  });

  it("What an import never does", async () => {
    const alex = await register("Alex");
    const sam = await register("Sam");
    const st = await busyStation(alex, sam);
    const file = (await exportOf(alex, st.slug)).json;

    // Songs already known are reused as they are here.
    await db.update(tracks).set({ title: "Alpha (renamed here)" }).where(eq(tracks.sourceKey, file.songs[0].sourceKey));
    const known = await importAs(alex, file, "?slug=copy-one");
    expect(known.json.summary.newSongs).toBe(0);
    expect((await db.select().from(tracks).where(eq(tracks.sourceKey, file.songs[0].sourceKey)))[0].title).toBe("Alpha (renamed here)");

    // A song on air goes back to the front of the line.
    const onAir = structuredClone(file);
    onAir.plays[2] = { ...onAir.plays[2], status: "playing", endedAt: null };
    const r = await importAs(alex, onAir, "?slug=copy-two");
    const queue = (await call("GET", "/api/radios/copy-two/queue", { cookie: alex.cookie })).json.items;
    expect(queue.map((q: any) => [q.track.title, q.status])).toEqual([
      ["Alpha (renamed here)", "queued"],
      ["Charlie", "queued"],
    ]);
    expect(r.json.summary).toMatchObject({ plays: 2, queued: 2 });

    // Refused: not a station file, dangling references, two songs on air, taken address.
    expect((await importAs(alex, { hello: "world" }, "?slug=nope")).status).toBe(400);
    const dangling = structuredClone(file);
    dangling.plays[0].song = "s404";
    const bad = await importAs(alex, dangling, "?slug=nope");
    expect(bad.status).toBe(400);
    expect(bad.json.error).toMatch(/doesn't describe/);
    const twoOnAir = structuredClone(file);
    twoOnAir.plays[0].status = twoOnAir.plays[2].status = "playing";
    expect((await importAs(alex, twoOnAir, "?slug=nope")).status).toBe(400);
    expect((await importAs(alex, file, `?slug=${st.slug}`)).status).toBe(409);
    expect((await call("GET", "/api/radios/nope", { cookie: alex.cookie })).status).toBe(404);
    // Nothing half-imported either: the refused imports left no station and no placeholder.
    expect((await db.select().from(users)).length).toBe(2);

    // Admins only; bigger than the usual 64 kB is fine.
    expect((await importAs(sam, file, "?slug=nope")).status).toBe(403);
    const big = structuredClone(file);
    big.station.description = "";
    big.songs.push(
      ...Array.from({ length: 800 }, (_, i) => ({ ...file.songs[0], ref: `x${i}`, sourceKey: `Youtube:big${i}`, sourceUrl: `https://www.youtube.com/watch?v=big${i}` })),
    );
    expect(JSON.stringify(big).length).toBeGreaterThan(64 * 1024);
    expect((await importAs(alex, big, "?slug=big")).status).toBe(201);
  });

  it("A radio can turn export and import off", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex);
    const file = (await exportOf(alex, st.slug)).json;
    process.env.STATION_TRANSFER = "off";
    try {
      const out = await exportOf(alex, st.slug);
      expect(out.status).toBe(404);
      expect(out.json.error).toBe("Station export and import are turned off on this radio");
      expect((await importAs(alex, file, "?slug=nope")).status).toBe(404);
      expect((await call("GET", "/api/settings")).json.stationTransfer).toBe(false);
      expect((await call("GET", "/api/legal")).json.stationTransfer).toBe(false); // the notice drops that section
    } finally {
      delete process.env.STATION_TRANSFER;
    }
    expect((await exportOf(alex, st.slug)).status).toBe(200);
    expect((await call("GET", "/api/legal")).json.stationTransfer).toBe(true);
  });
});
