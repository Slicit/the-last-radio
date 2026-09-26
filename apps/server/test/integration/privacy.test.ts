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
    expect((await call("POST", "/api/auth/login", { body: { email: sam.email, password: sam.password } })).status).toBe(401);
    // The only admin can't leave the radio without one.
    const solo = await call("DELETE", "/api/me", { cookie: alex.cookie, origin: ORIGIN, body: { password: alex.password } });
    expect(solo.status).toBe(409);
  });
});
