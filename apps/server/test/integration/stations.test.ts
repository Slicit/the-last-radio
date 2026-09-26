import { describe, expect, it } from "vitest";
import { call, createStation, register } from "./helpers.js";

// specs/features/stations.feature
describe("Stations", () => {
  it("A disabled station disappears for listeners", async () => {
    const alex = await register("Alex");
    const sam = await register("Sam");
    const st = await createStation(alex, { slug: "night-shift", isActive: false });
    const forSam = await call("GET", "/api/radios", { cookie: sam.cookie });
    expect(forSam.json.radios.map((r: any) => r.slug)).not.toContain(st.slug);
    expect((await call("GET", `/api/radios/${st.slug}`, { cookie: sam.cookie })).status).toBe(404);
    const forAlex = await call("GET", "/api/radios", { cookie: alex.cookie });
    expect(forAlex.json.radios.find((r: any) => r.slug === st.slug)?.isActive).toBe(false);
  });

  it("Only admins manage stations, and only from the website", async () => {
    const alex = await register("Alex");
    const sam = await register("Sam");
    const asPlayer = await call("POST", "/api/radios", { cookie: sam.cookie, body: { slug: "x", name: "X" } });
    expect(asPlayer.status).toBe(403);
    const key = await call("POST", "/api/access/keys", { cookie: alex.cookie, body: { name: "k", scopes: ["radio:read", "radio:write"] } });
    const withKey = await call("POST", "/api/radios", { token: key.json.token, body: { slug: "y", name: "Y" } });
    expect(withKey.status).toBe(403);
    expect(withKey.json.error).toBe("Admin actions need the website");
  });

  it("slugs are unique and well-formed", async () => {
    const alex = await register("Alex");
    await createStation(alex, { slug: "main" });
    expect((await call("POST", "/api/radios", { cookie: alex.cookie, body: { slug: "main", name: "Again" } })).status).toBe(409);
    expect((await call("POST", "/api/radios", { cookie: alex.cookie, body: { slug: "Bad Slug!", name: "Bad" } })).status).toBe(400);
  });
});
