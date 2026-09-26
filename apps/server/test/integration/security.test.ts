import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { db, schema } from "../../src/db/index.js";
import { call, createStation, ORIGIN, register, track } from "./helpers.js";

// specs/features/security.feature
describe("Security", () => {
  it("Cross-site requests can't ride on a session", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex);
    const t = await track();
    const evil = await call("POST", `/api/radios/${st.slug}/queue`, { cookie: alex.cookie, origin: "https://evil.example", body: { trackId: t.id } });
    expect(evil.status).toBe(403);
    expect(evil.json.error).toBe("Cross-site request refused");
    const ours = await call("POST", `/api/radios/${st.slug}/queue`, { cookie: alex.cookie, origin: ORIGIN, body: { trackId: t.id } });
    expect(ours.status).toBe(201);
  });

  it("Large requests are refused", async () => {
    const r = await call("POST", "/api/auth/login", { body: JSON.stringify({ email: "a@b.c", password: "x".repeat(70_000) }) });
    expect(r.status).toBe(413);
  });

  it("Secrets are never stored in the clear", async () => {
    const sam = await register("Sam");
    const cookieToken = sam.cookie.split("=")[1];
    const k = await call("POST", "/api/access/keys", { cookie: sam.cookie, body: { name: "k", scopes: ["radio:read"] } });
    const [session] = await db.select().from(schema.sessions);
    expect(session.id).toBe(createHash("sha256").update(cookieToken).digest("hex"));
    const [tok] = await db.select().from(schema.apiTokens);
    expect(tok.tokenHash).toBe(createHash("sha256").update(k.json.token).digest("hex"));
    const dump = JSON.stringify(await db.select().from(schema.apiTokens)) + JSON.stringify(await db.select().from(schema.sessions));
    expect(dump).not.toContain(k.json.token);
    expect(dump).not.toContain(cookieToken);
  });

  it("a refused request says when to try again", async () => {
    const ip = "10.66.6.6";
    let last;
    for (let i = 0; i < 11; i++) last = await call("POST", "/api/oauth/register", { ip, body: { client_name: "x", redirect_uris: ["https://a.example/cb"] } });
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("the MCP endpoint points unauthenticated clients to OAuth discovery", async () => {
    const meta = await call("GET", "/.well-known/oauth-protected-resource");
    expect(meta.json).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] });
    const as = await call("GET", "/.well-known/oauth-authorization-server");
    expect(as.json).toMatchObject({ code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] });
  });
});
