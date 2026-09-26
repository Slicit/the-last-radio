import { describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { db, schema } from "../../src/db/index.js";
import { add, app, call, createStation, ORIGIN, putOnAir, register, track, type Person } from "./helpers.js";

async function key(who: Person, scopes: string[] = ["radio:read", "radio:write"]) {
  const r = await call("POST", "/api/access/keys", { cookie: who.cookie, body: { name: "test key", scopes } });
  return r.json as { token: string; key: { id: string; prefix: string } };
}

async function mcp(token: string | null, method: string, params: object = {}, cookie?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "x-real-ip": "10.55.0.1",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  const res = await app.fetch(new Request(`${ORIGIN}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));
  return { status: res.status, headers: res.headers, json: (await res.json().catch(() => null)) as any };
}
const tool = async (token: string, name: string, args: object = {}) => {
  const r = await mcp(token, "tools/call", { name, arguments: args });
  return { text: r.json.result.content.map((c: any) => c.text).join("\n") as string, isError: !!r.json.result.isError };
};

// specs/features/connect-your-ai.feature
describe("Connect your AI", () => {
  it("Creating an API key", async () => {
    const sam = await register("Sam");
    const k = await key(sam);
    expect(k.token).toMatch(/^lr_key_[A-Za-z0-9_-]{43}$/);
    const list = await call("GET", "/api/access", { cookie: sam.cookie });
    expect(list.json.keys).toHaveLength(1);
    expect(list.json.keys[0].prefix).toBe(k.token.slice(0, 11));
    expect(JSON.stringify(list.json)).not.toContain(k.token);
  });

  it("What a key can do", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex);
    const ro = await key(alex, ["radio:read"]);
    const rw = await key(alex);
    const t = await track();
    expect((await call("GET", "/api/radios", { token: ro.token })).status).toBe(200);
    expect((await call("POST", `/api/radios/${st.slug}/queue`, { token: ro.token, body: { trackId: t.id } })).status).toBe(403);
    expect((await call("POST", `/api/radios/${st.slug}/queue`, { token: rw.token, body: { trackId: t.id } })).status).toBe(201);
    expect((await call("GET", "/api/access", { token: rw.token })).status).toBe(403);
    expect((await call("GET", "/api/users", { token: rw.token })).status).toBe(403);
    expect((await call("GET", "/api/admin/feedback", { token: rw.token })).status).toBe(403);
  });

  it("Revoking a key", async () => {
    const sam = await register("Sam");
    const k = await key(sam);
    await call("DELETE", `/api/access/keys/${k.key.id}`, { cookie: sam.cookie });
    const r = await call("GET", "/api/radios", { token: k.token });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  describe("OAuth", () => {
    const redirect = "http://127.0.0.1:33418/callback";
    async function connect(sam: Person) {
      const reg = await call("POST", "/api/oauth/register", { body: { client_name: "Test Assistant", redirect_uris: [redirect] } });
      const verifier = randomBytes(32).toString("base64url");
      const params = {
        response_type: "code",
        client_id: reg.json.client_id,
        redirect_uri: "http://127.0.0.1:50000/callback",
        code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        code_challenge_method: "S256",
        scope: "radio:read radio:write",
        state: "st4te",
      };
      const decide = (approve: boolean) =>
        call("POST", "/api/oauth/authorize", { cookie: sam.cookie, origin: ORIGIN, body: { ...params, approve } });
      const exchange = (body: Record<string, string>) =>
        app.fetch(
          new Request(`${ORIGIN}/api/oauth/token`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", "x-real-ip": "10.55.0.2" },
            body: new URLSearchParams(body),
          }),
        ).then(async (r) => ({ status: r.status, json: await r.json() }));
      return { reg: reg.json, verifier, params, decide, exchange };
    }

    it("Connecting an assistant with OAuth", async () => {
      const sam = await register("Sam");
      const o = await connect(sam);
      expect(o.reg.client_id).toMatch(/^lrc_/);
      const info = await call("GET", `/api/oauth/authorize?${new URLSearchParams(o.params)}`, { cookie: sam.cookie });
      expect(info.json.client.name).toBe("Test Assistant");
      const back = new URL((await o.decide(true)).json.redirectTo);
      expect(back.searchParams.get("state")).toBe("st4te");
      const tokens = await o.exchange({
        grant_type: "authorization_code",
        code: back.searchParams.get("code")!,
        client_id: o.reg.client_id,
        redirect_uri: o.params.redirect_uri,
        code_verifier: o.verifier,
      });
      expect(tokens.json).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "radio:read radio:write" });
      expect((await call("GET", "/api/radios", { token: tokens.json.access_token })).status).toBe(200);
      const apps = await call("GET", "/api/access", { cookie: sam.cookie });
      expect(apps.json.apps.map((a: any) => a.name)).toEqual(["Test Assistant"]);
    });

    it("OAuth is strict", async () => {
      const sam = await register("Sam");
      const o = await connect(sam);
      // wrong verifier fails and burns the code
      const code1 = new URL((await o.decide(true)).json.redirectTo).searchParams.get("code")!;
      const base = { grant_type: "authorization_code", client_id: o.reg.client_id, redirect_uri: o.params.redirect_uri };
      expect((await o.exchange({ ...base, code: code1, code_verifier: "x".repeat(43) })).json.error).toBe("invalid_grant");
      expect((await o.exchange({ ...base, code: code1, code_verifier: o.verifier })).status).toBe(400);
      // a code works once
      const code2 = new URL((await o.decide(true)).json.redirectTo).searchParams.get("code")!;
      const t1 = (await o.exchange({ ...base, code: code2, code_verifier: o.verifier })).json;
      expect((await o.exchange({ ...base, code: code2, code_verifier: o.verifier })).status).toBe(400);
      // refresh rotates…
      const t2 = (await o.exchange({ grant_type: "refresh_token", refresh_token: t1.refresh_token, client_id: o.reg.client_id })).json;
      expect(t2.refresh_token).not.toBe(t1.refresh_token);
      // …and replaying a spent one revokes the whole connection
      expect((await o.exchange({ grant_type: "refresh_token", refresh_token: t1.refresh_token, client_id: o.reg.client_id })).status).toBe(400);
      expect((await call("GET", "/api/radios", { token: t2.access_token })).status).toBe(401);
      expect((await o.exchange({ grant_type: "refresh_token", refresh_token: t2.refresh_token, client_id: o.reg.client_id })).status).toBe(400);
      // redirects
      const evil = await call("POST", "/api/oauth/register", { body: { client_name: "x", redirect_uris: ["http://evil.example/cb"] } });
      expect(evil.status).toBe(400);
      const mismatch = await call("GET", `/api/oauth/authorize?${new URLSearchParams({ ...o.params, redirect_uri: "https://evil.example/cb" })}`, { cookie: sam.cookie });
      expect(mismatch.status).toBe(400);
      const plain = await call("GET", `/api/oauth/authorize?${new URLSearchParams({ ...o.params, code_challenge_method: "plain" })}`, { cookie: sam.cookie });
      expect(plain.status).toBe(400);
    });

    it("Deny and disconnect", async () => {
      const sam = await register("Sam");
      const o = await connect(sam);
      expect(new URL((await o.decide(false)).json.redirectTo).searchParams.get("error")).toBe("access_denied");
      const code = new URL((await o.decide(true)).json.redirectTo).searchParams.get("code")!;
      const t = (await o.exchange({ grant_type: "authorization_code", code, client_id: o.reg.client_id, redirect_uri: o.params.redirect_uri, code_verifier: o.verifier })).json;
      await call("DELETE", `/api/access/apps/${o.reg.client_id}`, { cookie: sam.cookie, origin: ORIGIN });
      expect((await call("GET", "/api/radios", { token: t.access_token })).status).toBe(401);
    });
  });

  describe("MCP", () => {
    it("Assistants can't use browser sessions", async () => {
      const sam = await register("Sam");
      const r = await mcp(null, "tools/list", {}, sam.cookie);
      expect(r.status).toBe(401);
      expect(r.headers.get("www-authenticate")).toContain("/.well-known/oauth-protected-resource");
    });

    it("The assistant's tools", async () => {
      const alex = await register("Alex");
      await createStation(alex, { slug: "main", name: "Main Stage" });
      const rw = await key(alex);
      const ro = await key(alex, ["radio:read"]);
      const names = (t: string) => mcp(t, "tools/list").then((r) => r.json.result.tools.map((x: any) => x.name).sort());
      expect(await names(rw.token)).toEqual(
        ["add_song", "downvote", "get_queue", "list_stations", "now_playing", "search_songs", "skip_my_song", "song_stats", "undo_downvote", "upvote"],
      );
      expect(await names(ro.token)).toEqual(["get_queue", "list_stations", "now_playing", "search_songs", "song_stats"]);
      expect((await tool(rw.token, "list_stations")).text).toContain("Main Stage (slug: main)");
      const unknown = await tool(rw.token, "now_playing", { station: "nope" });
      expect(unknown).toMatchObject({ isError: true });
      expect(unknown.text).toContain("Stations: Main Stage (main)");
      const t = await track({ title: "Derezzed" });
      const added = await tool(rw.token, "add_song", { station: "Main Stage", song_id: t.id });
      expect(added.text).toMatch(/^Added "Derezzed" to Main Stage: 1st in line, starts now\./);
      expect((await tool(rw.token, "add_song", { station: "main" })).text).toBe("Give exactly one of url, song_id or query.");
    });

    it("Tools act as the listener, within their limits", async () => {
      const alex = await register("Alex");
      const sam = await register("Sam");
      const st = await createStation(alex, { slug: "main", rateLimitCount: 1 });
      const k = await key(sam);
      expect((await tool(k.token, "add_song", { station: "main", song_id: (await track()).id })).isError).toBe(false);
      const second = await tool(k.token, "add_song", { station: "main", song_id: (await track()).id });
      expect(second.isError).toBe(true);
      expect(second.text).toMatch(/You've added your 1 songs for now/);
      const item = (await add(alex, st.slug, (await track()).id)).json;
      await putOnAir(item.id);
      expect((await tool(k.token, "downvote", { station: "main" })).text).toMatch(/^Tune in to vote/);
      const rows = await db.select().from(schema.queueItems);
      expect(rows.filter((r) => r.userId === sam.user.id)).toHaveLength(1);
    });
  });
});
