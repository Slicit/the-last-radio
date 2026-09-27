import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db/index.js";
import { alfredTopUp } from "../../src/lib/alfred.js";
import { app, call, createStation, ORIGIN, putOnAir, add, register, seededRandom, track, type Person } from "./helpers.js";

const { queueItems, radios } = schema;

async function played(radioId: string, who: Person, over: Parameters<typeof track>[0] = {}) {
  const t = await track(over);
  const at = new Date(Date.now() - 5 * 3600_000);
  await db.insert(queueItems).values({ radioId, trackId: t.id, userId: who.user.id, status: "played", startedAt: at, endedAt: at, createdAt: at });
  return t;
}
const up = (who: Person, slug: string, trackId: string) => call("POST", `/api/radios/${slug}/upvotes`, { cookie: who.cookie, origin: ORIGIN, body: { trackId } });

// specs/features/upvotes.feature
describe("Upvotes", () => {
  it("Upvoting a song", async () => {
    const alex = await register("Alex");
    const sam = await register("Sam");
    const st = await createStation(alex);
    const t = await played(st.id, alex, { title: "Favourite" });
    const r = await up(sam, st.slug, t.id);
    expect(r.json).toMatchObject({ already: false, allowance: { remaining: 2 } });
    expect((await up(sam, st.slug, t.id)).json).toMatchObject({ already: true, allowance: { remaining: 2 } });
    const detail = (await call("GET", `/api/radios/${st.slug}`, { cookie: sam.cookie })).json;
    expect(detail.myUpvotes).toEqual([t.id]);
    const history = (await call("GET", `/api/radios/${st.slug}/history`)).json;
    expect(history.items[0].track.upvotes).toBe(1);
    await call("DELETE", `/api/radios/${st.slug}/upvotes/${t.id}`, { cookie: sam.cookie, origin: ORIGIN });
    expect((await call("GET", `/api/radios/${st.slug}`, { cookie: sam.cookie })).json.myUpvotes).toEqual([]);
  });

  it("Three upvotes a day", async () => {
    const alex = await register("Alex");
    const sam = await register("Sam");
    const a = await createStation(alex);
    const b = await createStation(alex);
    const songs = [await played(a.id, alex), await played(a.id, alex), await played(b.id, alex), await played(b.id, alex)];
    expect((await up(sam, a.slug, songs[0].id)).status).toBe(200);
    expect((await up(sam, a.slug, songs[1].id)).status).toBe(200);
    expect((await up(sam, b.slug, songs[2].id)).status).toBe(200); // across stations
    const fourth = await up(sam, b.slug, songs[3].id);
    expect(fourth.status).toBe(429);
    expect(fourth.json.error).toMatch(/^You've used your 3 upvotes for today\. More in ~\d+ h\.$/);
    await call("DELETE", `/api/radios/${a.slug}/upvotes/${songs[0].id}`, { cookie: sam.cookie, origin: ORIGIN });
    expect((await up(sam, b.slug, songs[3].id)).status).toBe(200);
  });

  it("Upvoted songs come back more often", async () => {
    const alex = await register("Alex");
    const fans = [await register("F1"), await register("F2"), await register("F3")];
    const st = await createStation(alex, { autofillBelowSec: 100 });
    const loved = await played(st.id, alex, { title: "Loved", durationSec: 200 });
    await played(st.id, alex, { title: "Plain", durationSec: 200 });
    for (const f of fans) await up(f, st.slug, loved.id);
    const songs = (await call("GET", `/api/radios/${st.slug}/songs?sort=score`)).json.items;
    expect(songs[0]).toMatchObject({ track: { title: "Loved" }, upvotes: 3, score: 9 }); // 1 + 2 + 3×2
    expect(songs[1]).toMatchObject({ track: { title: "Plain" }, upvotes: 0, score: 3 });
    const radio = (await db.query.radios.findFirst({ where: eq(radios.id, st.id) }))!;
    // Seeded: the same 40 draws every run, so the test can't fail by bad luck.
    const random = seededRandom(11);
    let lovedWins = 0;
    for (let i = 0; i < 40; i++) {
      const [pick] = await alfredTopUp(radio, random);
      if (pick.startsWith("Loved")) lovedWins++;
      await db.delete(queueItems).where(eq(queueItems.isFill, true));
    }
    expect(lovedWins).toBeGreaterThan(22); // 9 vs 3: ~75% of draws
  });

  it("What can be upvoted", async () => {
    const alex = await register("Alex");
    const sam = await register("Sam");
    const st = await createStation(alex);
    const stranger = await track();
    expect((await up(sam, st.slug, stranger.id)).status).toBe(404);
    const hidden = await createStation(alex, { isPrivate: true });
    const t = await played(hidden.id, alex);
    expect((await up(sam, hidden.slug, t.id)).status).toBe(404);
    // AI assistant: upvote the song on air.
    const item = (await add(alex, st.slug, (await track({ title: "On Air Now" })).id)).json;
    await putOnAir(item.id);
    const key = (await call("POST", "/api/access/keys", { cookie: sam.cookie, body: { name: "k", scopes: ["radio:read", "radio:write"] } })).json.token;
    const res = await app
      .fetch(
        new Request(`${ORIGIN}/mcp`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "upvote", arguments: { station: st.slug } } }),
        }),
      )
      .then((r) => r.json() as any);
    expect(res.result.content[0].text).toMatch(/^Upvoted "On Air Now" on .*\. 2 upvotes left today\.$/);
    const exported = (await call("GET", "/api/me/export", { cookie: sam.cookie })).json;
    expect(exported.upvotes).toHaveLength(1);
  });
});
