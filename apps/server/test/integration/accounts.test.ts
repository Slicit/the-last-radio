import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db/index.js";
import { call, freshIp, register } from "./helpers.js";

// specs/features/accounts.feature
describe("Accounts", () => {
  it("The first account becomes the admin", async () => {
    const alex = await register("Alex");
    expect(alex.user.role).toBe("admin");
    const me = await call("GET", "/api/auth/me", { cookie: alex.cookie });
    expect(me.json.user.email).toBe(alex.email);
  });

  it("Later accounts are players", async () => {
    await register("Alex");
    const sam = await register("Sam");
    expect(sam.user.role).toBe("player");
  });

  it("A wrong password gives the same answer as an unknown email", async () => {
    const sam = await register("Sam");
    const wrong = await call("POST", "/api/auth/login", { body: { email: sam.email, password: "nope-nope-nope" } });
    const unknown = await call("POST", "/api/auth/login", { body: { email: "nobody@radio.test", password: "nope-nope-nope" } });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.json.error).toBe("Wrong email or password");
    expect(unknown.json.error).toBe(wrong.json.error);
  });

  it("Too many wrong passwords lock the account for a while", async () => {
    const sam = await register("Sam");
    for (let i = 0; i < 5; i++) {
      expect((await call("POST", "/api/auth/login", { body: { email: sam.email, password: `guess-${i}-xx` } })).status).toBe(401);
    }
    const sixth = await call("POST", "/api/auth/login", { body: { email: sam.email, password: "guess-6-xxx" } });
    expect(sixth.status).toBe(429);
    expect(sixth.json.error).toMatch(/Too many wrong passwords for this account/);
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
    const right = await call("POST", "/api/auth/login", { body: { email: sam.email, password: sam.password } });
    expect(right.status).toBe(429);
  });

  it("a successful sign-in resets the failure count", async () => {
    const kim = await register("Kim");
    for (let i = 0; i < 4; i++) await call("POST", "/api/auth/login", { body: { email: kim.email, password: `bad-${i}-xxxx` } });
    expect((await call("POST", "/api/auth/login", { body: { email: kim.email, password: kim.password } })).status).toBe(200);
    for (let i = 0; i < 4; i++) await call("POST", "/api/auth/login", { body: { email: kim.email, password: `bad-${i}-yyyy` } });
    expect((await call("POST", "/api/auth/login", { body: { email: kim.email, password: kim.password } })).status).toBe(200);
  });

  it("Registrations are rate limited per network", async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      const r = await call("POST", "/api/auth/register", { ip, body: { email: `n${i}@radio.test`, password: "a-good-password", displayName: `N${i}`, acceptPrivacy: true } });
      expect(r.status).toBe(201);
    }
    const sixth = await call("POST", "/api/auth/register", { ip, body: { email: "n6@radio.test", password: "a-good-password", displayName: "N6", acceptPrivacy: true } });
    expect(sixth.status).toBe(429);
  });

  it("Passwords are stored salted and hashed", async () => {
    const a = await register("Ann", "the-same-password");
    const b = await register("Ben", "the-same-password");
    const rows = await db.select().from(schema.users);
    const hashes = rows.map((r) => r.passwordHash);
    for (const h of hashes) {
      expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      expect(h).not.toContain("the-same-password");
    }
    expect(new Set(hashes).size).toBe(2);
    const short = await call("POST", "/api/auth/register", { body: { email: "s@radio.test", password: "short", displayName: "Short", acceptPrivacy: true } });
    expect(short.status).toBe(400);
    expect([a.user.id, b.user.id]).toHaveLength(2);
  });

  it("Registering an email twice", async () => {
    const sam = await register("Sam");
    const again = await call("POST", "/api/auth/register", { body: { email: sam.email.toUpperCase(), password: "another-password", displayName: "Sam2", acceptPrivacy: true } });
    expect(again.status).toBe(409);
    expect(again.json.error).toBe("That email is already registered");
  });

  it("signing out ends the session", async () => {
    const sam = await register("Sam");
    await call("POST", "/api/auth/logout", { cookie: sam.cookie, origin: "http://radio.test" });
    const me = await call("GET", "/api/auth/me", { cookie: sam.cookie });
    expect(me.json.user).toBeNull();
    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, sam.user.id));
    expect(row).toBeDefined();
  });
});
