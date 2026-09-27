import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { db, schema } from "../../src/db/index.js";
import { add, app, call, createStation, ORIGIN, register, track, type Person } from "./helpers.js";

async function upload(who: Person, bytes: Buffer, name = "photo.png", type = "image/png", ip?: string) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type }));
  const res = await app.fetch(
    new Request(`${ORIGIN}/api/me/avatar`, {
      method: "PUT",
      headers: { cookie: who.cookie, origin: ORIGIN, "x-real-ip": ip ?? `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
      body: form,
    }),
  );
  return { status: res.status, json: (await res.json()) as any };
}
const photo = () => sharp({ create: { width: 300, height: 200, channels: 3, background: "#0a6" } }).jpeg().toBuffer();

// specs/features/profile.feature
describe("Profile and appearance", () => {
  it("Choosing a theme", async () => {
    const sam = await register("Sam");
    expect(sam.user).toMatchObject({ theme: "night" });
    const r = await call("PATCH", "/api/me", { cookie: sam.cookie, origin: ORIGIN, body: { theme: "vintage" } });
    expect(r.json.user.theme).toBe("vintage");
    // Another device: a fresh sign-in sees the same theme.
    const again = await call("POST", "/api/auth/login", { body: { email: sam.email, password: sam.password } });
    expect(again.json.user.theme).toBe("vintage");
    expect((await call("PATCH", "/api/me", { cookie: sam.cookie, body: { theme: "hacker" } })).status).toBe(400);
  });

  it("The radio's default theme", async () => {
    const alex = await register("Alex"); // first account: admin
    const sam = await register("Sam");
    expect((await call("GET", "/api/settings")).json).toEqual({ defaultTheme: "night" });
    const set = await call("PATCH", "/api/admin/settings", { cookie: alex.cookie, origin: ORIGIN, body: { defaultTheme: "light" } });
    expect(set.json).toEqual({ defaultTheme: "light" });
    expect((await call("GET", "/api/settings")).json).toEqual({ defaultTheme: "light" }); // what guests get
    const kim = await register("Kim");
    expect(kim.user).toMatchObject({ theme: "light" }); // new accounts start with it
    const me = await call("GET", "/api/auth/me", { cookie: sam.cookie });
    expect(me.json.user.theme).toBe("night"); // existing accounts keep theirs
    // Admins only, from the website, and only known themes.
    expect((await call("PATCH", "/api/admin/settings", { cookie: sam.cookie, origin: ORIGIN, body: { defaultTheme: "vintage" } })).status).toBe(403);
    expect((await call("PATCH", "/api/admin/settings", { cookie: alex.cookie, origin: ORIGIN, body: { defaultTheme: "hacker" } })).status).toBe(400);
  });

  it("Setting a profile photo", async () => {
    const sam = await register("Sam");
    const up = await upload(sam, await photo());
    expect(up.status).toBe(200);
    const url: string = up.json.user.avatarUrl;
    expect(url).toMatch(/^\/api\/avatars\/[0-9a-f-]{36}\?v=\d+$/);
    const img = await app.fetch(new Request(`${ORIGIN}${url}`));
    expect(img.headers.get("content-type")).toBe("image/webp");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(img.headers.get("content-security-policy")).toContain("sandbox");
    expect((await sharp(Buffer.from(await img.arrayBuffer())).metadata()).width).toBe(256);
    const removed = await call("DELETE", "/api/me/avatar", { cookie: sam.cookie, origin: ORIGIN });
    expect(removed.json.user.avatarUrl).toBeNull();
    expect((await app.fetch(new Request(`${ORIGIN}${url}`))).status).toBe(404);
  });

  it("Profile photos are handled safely", async () => {
    const sam = await register("Sam");
    const fake = await upload(sam, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>" + " ".repeat(64)), "cat.png", "image/png");
    expect(fake).toMatchObject({ status: 415 });
    const big = Buffer.concat([await photo(), Buffer.alloc(5 * 1024 * 1024)]);
    expect((await upload(sam, big)).status).toBe(413);
    const [stored] = await db.select().from(schema.avatars);
    expect(stored).toBeUndefined(); // nothing kept from rejected uploads
    await upload(sam, await photo());
    const [row] = await db.select().from(schema.avatars);
    expect(row.image.subarray(8, 12).toString()).toBe("WEBP"); // re-encoded, not the JPEG we sent
  });

  it("someone can change their photo at most 10 times an hour", async () => {
    const sam = await register("Sam");
    const img = await photo();
    for (let i = 0; i < 10; i++) expect((await upload(sam, img)).status).toBe(200);
    expect((await upload(sam, img)).status).toBe(429);
  });

  it("Changing your display name", async () => {
    const alex = await register("Alex");
    const sam = await register("Sam");
    const st = await createStation(alex);
    await add(sam, st.slug, (await track()).id);
    await call("PATCH", "/api/me", { cookie: sam.cookie, origin: ORIGIN, body: { displayName: "Sammy" } });
    const q = (await call("GET", `/api/radios/${st.slug}`)).json.queue;
    expect(q[0].pushedBy.displayName).toBe("Sammy");
    expect((await call("PATCH", "/api/me", { cookie: sam.cookie, body: { displayName: "S" } })).status).toBe(400);
  });

  it("profile changes need the website, not an API key", async () => {
    const sam = await register("Sam");
    const k = await call("POST", "/api/access/keys", { cookie: sam.cookie, body: { name: "k", scopes: ["radio:read", "radio:write"] } });
    expect((await call("PATCH", "/api/me", { token: k.json.token, body: { theme: "light" } })).status).toBe(403);
  });
});
