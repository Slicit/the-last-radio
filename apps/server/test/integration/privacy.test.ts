import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db/index.js";
import { POLICY_VERSION } from "../../src/lib/legal.js";
import { add, call, createStation, ORIGIN, register, track } from "./helpers.js";

// specs/features/privacy.feature
describe("Privacy", () => {
  it("Acknowledging the notice when signing up", async () => {
    const without = await call("POST", "/api/auth/register", { body: { email: "x@radio.test", password: "a-good-password", displayName: "Xavier" } });
    expect(without.status).toBe(400);
    expect(without.json.error).toMatch(/privacy notice/);
    const sam = await register("Sam");
    expect(sam.user).toMatchObject({ privacyAckRequired: false });
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, sam.user.id));
    expect(row.privacyAckVersion).toBe(POLICY_VERSION);
  });

  it("Acknowledging a new or changed notice when signing in", async () => {
    const sam = await register("Sam");
    await db.update(schema.users).set({ privacyAckVersion: "2020-01-01" }).where(eq(schema.users.id, sam.user.id));
    const login = await call("POST", "/api/auth/login", { body: { email: sam.email, password: sam.password } });
    expect(login.json.user.privacyAckRequired).toBe(true);
    const stale = await call("POST", "/api/me/privacy-ack", { cookie: sam.cookie, origin: ORIGIN, body: { version: "2020-01-01" } });
    expect(stale.status).toBe(409);
    const ok = await call("POST", "/api/me/privacy-ack", { cookie: sam.cookie, origin: ORIGIN, body: { version: POLICY_VERSION } });
    expect(ok.json.user.privacyAckRequired).toBe(false);
  });

  it("No consent banner", async () => {
    const r = await call("POST", "/api/auth/register", {
      body: { email: "c@radio.test", password: "a-good-password", displayName: "Chloe", acceptPrivacy: true },
    });
    const cookies = r.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/^lr_session=[^;]+;.*HttpOnly.*SameSite=Lax/i);
    expect((await call("GET", "/api/legal")).json.policyVersion).toBe(POLICY_VERSION);
  });

  it("names the host and where data lives, when set", async () => {
    expect((await call("GET", "/api/legal")).json).toMatchObject({ hosting: null, dataLocation: null });
    process.env.HOSTING_PROVIDER = "Example Hosting SAS, 1 rue Exemple, 75000 Paris, France";
    process.env.DATA_LOCATION = "France";
    try {
      expect((await call("GET", "/api/legal")).json).toMatchObject({ hosting: "Example Hosting SAS, 1 rue Exemple, 75000 Paris, France", dataLocation: "France" });
    } finally {
      delete process.env.HOSTING_PROVIDER;
      delete process.env.DATA_LOCATION;
    }
  });

  it("Downloading my data", async () => {
    const alex = await register("Alex");
    const sam = await register("Sam");
    const st = await createStation(alex);
    await add(sam, st.slug, (await track({ title: "Mine" })).id);
    await call("POST", "/api/feedback", { cookie: sam.cookie, origin: ORIGIN, body: { body: "A thought about the radio" } });
    await call("POST", "/api/access/keys", { cookie: sam.cookie, body: { name: "laptop", scopes: ["radio:read"] } });
    const r = await call("GET", "/api/me/export", { cookie: sam.cookie });
    expect(r.headers.get("content-disposition")).toContain("attachment");
    expect(r.json.account.email).toBe(sam.email);
    expect(r.json.songsAdded[0]).toMatchObject({ title: "Mine", station: st.slug });
    expect(r.json.feedback[0].message).toBe("A thought about the radio");
    expect(r.json.apiAccess[0]).toMatchObject({ name: "laptop" });
    const text = JSON.stringify(r.json);
    expect(text).not.toMatch(/argon2|password_hash|token_hash|lr_key_/);
  });

  it("Deleting my account", async () => {
    const alex = await register("Alex");
    const sam = await register("Sam");
    const st = await createStation(alex);
    await add(sam, st.slug, (await track({ title: "Still here" })).id);
    // Sam's past: a song aired, a skip vote and an upvote on someone else's song.
    const past = new Date(Date.now() - 3600_000);
    const aired = await track({ title: "Sam's classic" });
    await db.insert(schema.queueItems).values({ radioId: st.id, trackId: aired.id, userId: sam.user.id, status: "played", createdAt: past, startedAt: past, endedAt: past });
    const alexSong = await track({ title: "Alex's pick" });
    const [alexItem] = await db
      .insert(schema.queueItems)
      .values({ radioId: st.id, trackId: alexSong.id, userId: alex.user.id, status: "played", createdAt: past, startedAt: past, endedAt: past })
      .returning();
    await db.insert(schema.skipVotes).values({ queueItemId: alexItem.id, userId: sam.user.id });
    await db.insert(schema.songUpvotes).values({ userId: sam.user.id, radioId: st.id, trackId: alexSong.id });
    await call("PUT", "/api/me", { cookie: sam.cookie });
    expect((await call("DELETE", "/api/me", { cookie: sam.cookie, origin: ORIGIN, body: { password: "wrong-one" } })).status).toBe(403);
    const del = await call("DELETE", "/api/me", { cookie: sam.cookie, origin: ORIGIN, body: { password: sam.password } });
    expect(del.status).toBe(200);
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, sam.user.id));
    expect(row).toMatchObject({ displayName: "Former listener", passwordHash: "!", avatarUpdatedAt: null });
    expect(row.email).not.toBe(sam.email);
    expect(row.deletedAt).not.toBeNull();
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, sam.user.id))).toEqual([]);
    const q = (await call("GET", `/api/radios/${st.slug}`)).json.queue;
    expect(q[0].pushedBy.displayName).toBe("Former listener");
    // Everything Sam did stays, credited to "Former listener": plays, votes, upvotes, rankings.
    const history = (await call("GET", `/api/radios/${st.slug}/history`)).json.items;
    expect(history.find((h: any) => h.track.title === "Sam's classic").pushedBy.displayName).toBe("Former listener");
    expect(await db.select().from(schema.skipVotes).where(eq(schema.skipVotes.userId, sam.user.id))).toHaveLength(1);
    expect(await db.select().from(schema.songUpvotes).where(eq(schema.songUpvotes.userId, sam.user.id))).toHaveLength(1);
    const songs = (await call("GET", `/api/radios/${st.slug}/songs`)).json.items;
    expect(songs.find((s: any) => s.track.title === "Alex's pick")).toMatchObject({ downvotes: 1, upvotes: 1 });
    const stats = (await call("GET", `/api/radios/${st.slug}/stats`)).json;
    expect(stats.topPlayers.map((p: any) => p.user.displayName)).toContain("Former listener");
    expect((await call("POST", "/api/auth/login", { body: { email: sam.email, password: sam.password } })).status).toBe(401);
    // The only admin can't leave the radio without one.
    const solo = await call("DELETE", "/api/me", { cookie: alex.cookie, origin: ORIGIN, body: { password: alex.password } });
    expect(solo.status).toBe(409);
  });
});
