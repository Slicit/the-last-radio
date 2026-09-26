import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db/index.js";
import { capturedMail } from "../../src/lib/mail.js";
import { add, app, call, createStation, ORIGIN, register, track, type Person } from "./helpers.js";

const slugs = async (who?: Person) => (await call("GET", "/api/radios", { cookie: who?.cookie })).json.radios.map((r: any) => r.slug);
const hls = (slug: string, who?: Person) =>
  app.fetch(new Request(`${ORIGIN}/api/internal/hls-auth`, { headers: { "x-original-uri": `/hls/${slug}/index.m3u8`, ...(who ? { cookie: who.cookie } : {}) } })).then((r) => r.status);
const linkFor = (email: string) => {
  const mail = [...capturedMail].reverse().find((m) => m.to === email);
  return mail?.text.match(/\/verify-email\?token=([\w-]+)/)?.[1];
};

async function setup() {
  const alex = await register("Alex");
  const sam = await register("Sam");
  const team = await createStation(alex, { slug: "team-room", name: "Team Room", isPrivate: true });
  const open = await createStation(alex, { slug: "open-air", name: "Open Air" });
  return { alex, sam, team, open };
}

// specs/features/private-stations.feature
describe("Private stations", () => {
  beforeEach(() => void capturedMail.splice(0));

  it("A private station is invisible to everyone else", async () => {
    const { alex, sam, team, open } = await setup();
    expect(await slugs(sam)).toEqual([open.slug]);
    expect(await slugs()).toEqual([open.slug]);
    for (const path of ["", "/queue", "/history", "/songs", "/stats", "/stream"]) {
      const r = await call("GET", `/api/radios/${team.slug}${path}`, { cookie: sam.cookie });
      expect([path, r.status]).toEqual([path, 404]);
    }
    expect((await add(sam, team.slug, (await track()).id)).status).toBe(404);
    expect((await call("POST", `/api/radios/${team.slug}/listen`, { body: { listenerId: "sneaky-listener" } })).status).toBe(404);
    expect(await hls(team.slug)).toBe(403);
    expect(await hls(team.slug, sam)).toBe(403);
    expect(await hls(open.slug)).toBe(204);
    // Tokens act as their user.
    const key = (await call("POST", "/api/access/keys", { cookie: sam.cookie, body: { name: "k", scopes: ["radio:read"] } })).json.token;
    expect((await call("GET", `/api/radios/${team.slug}`, { token: key })).status).toBe(404);
    const mcp = await app.fetch(
      new Request(`${ORIGIN}/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_stations", arguments: {} } }),
      }),
    ).then((r) => r.json() as any);
    expect(mcp.result.content[0].text).not.toContain("Team Room");
    void alex;
  });

  it("Adding someone by email", async () => {
    const { alex, sam, team } = await setup();
    const r = await call("POST", `/api/radios/${team.slug}/members`, { cookie: alex.cookie, body: { email: sam.email } });
    expect(r.status).toBe(201);
    expect(await slugs(sam)).toContain(team.slug);
    expect((await add(sam, team.slug, (await track()).id)).status).toBe(201);
    expect(await hls(team.slug, sam)).toBe(204);
    const nobody = await call("POST", `/api/radios/${team.slug}/members`, { cookie: alex.cookie, body: { email: "ghost@radio.test" } });
    expect(nobody.json.error).toBe("Nobody has an account with that email yet");
    await call("DELETE", `/api/radios/${team.slug}/members/${sam.user.id}`, { cookie: alex.cookie });
    expect(await slugs(sam)).not.toContain(team.slug);
  });

  it("Letting a whole email domain in", async () => {
    const { alex, team } = await setup();
    await call("POST", `/api/radios/${team.slug}/domains`, { cookie: alex.cookie, body: { domain: "@Acme.TEST" } });
    const reg = await call("POST", "/api/auth/register", {
      body: { email: "vera@acme.test", password: "vera-password", displayName: "Vera", acceptPrivacy: true },
    });
    const vera = { cookie: reg.headers.get("set-cookie")!.split(";")[0] } as Person;
    expect(reg.json.user.emailVerified).toBe(false);
    expect(await slugs(vera)).not.toContain(team.slug); // not confirmed yet
    const token = linkFor("vera@acme.test");
    expect(token).toBeTruthy();
    expect((await call("POST", "/api/auth/verify-email", { body: { token } })).status).toBe(200);
    expect(await slugs(vera)).toContain(team.slug);
    expect(await hls(team.slug, vera)).toBe(204);
  });

  it("Confirming an email", async () => {
    const { alex, sam } = await setup();
    const token = linkFor(sam.email)!;
    expect((await call("POST", "/api/auth/verify-email", { body: { token } })).status).toBe(200);
    expect((await call("POST", "/api/auth/verify-email", { body: { token } })).status).toBe(400); // once only
    // A new link, then the address changes: the old link no longer proves anything.
    const kim = await register("Kim");
    const kimToken = linkFor(kim.email)!;
    await db.update(schema.users).set({ email: "kim.new@radio.test" }).where(eq(schema.users.id, kim.user.id));
    expect((await call("POST", "/api/auth/verify-email", { body: { token: kimToken } })).status).toBe(400);
    // Resend, rate limited to 3 an hour.
    const lee = await register("Lee");
    for (let i = 0; i < 3; i++) expect((await call("POST", "/api/me/verify-email", { cookie: lee.cookie, origin: ORIGIN })).status).toBe(200);
    expect((await call("POST", "/api/me/verify-email", { cookie: lee.cookie, origin: ORIGIN })).status).toBe(429);
    // Admins can vouch for an address.
    await call("PATCH", `/api/users/${lee.user.id}`, { cookie: alex.cookie, body: { emailVerified: true } });
    expect((await call("GET", "/api/auth/me", { cookie: lee.cookie })).json.user.emailVerified).toBe(true);
  });

  it("Admins see every station", async () => {
    const { alex, team } = await setup();
    expect(await slugs(alex)).toContain(team.slug);
    expect(await hls(team.slug, alex)).toBe(204);
    const access = (await call("GET", `/api/radios/${team.slug}/access`, { cookie: alex.cookie })).json;
    expect(access).toMatchObject({ isPrivate: true, members: [], domains: [], mailConfigured: true });
  });
});
