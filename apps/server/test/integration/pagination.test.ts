import { describe, expect, it } from "vitest";
import { db, schema } from "../../src/db/index.js";
import { call, createStation, ORIGIN, register, track } from "./helpers.js";

async function lineUp(radioId: string, userId: string, n: number) {
  const base = Date.now() - n * 1000;
  for (let i = 0; i < n; i++) {
    const t = await track({ title: `Queued ${String(i + 1).padStart(2, "0")}` });
    await db.insert(schema.queueItems).values({ radioId, trackId: t.id, userId, createdAt: new Date(base + i * 1000) });
  }
}

// specs/features/pagination.feature
describe("Long lists come in pages", () => {
  it("Paging through a long queue", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex);
    await lineUp(st.id, alex.user.id, 25);
    const p1 = (await call("GET", `/api/radios/${st.slug}/queue`)).json;
    expect(p1).toMatchObject({ total: 25, page: 1, pageSize: 20 });
    expect(p1.items).toHaveLength(20);
    expect(p1.items[0].track.title).toBe("Queued 01");
    const p2 = (await call("GET", `/api/radios/${st.slug}/queue?page=2`)).json;
    expect(p2.items.map((i: any) => i.track.title)).toEqual(["Queued 21", "Queued 22", "Queued 23", "Queued 24", "Queued 25"]);
    const detail = (await call("GET", `/api/radios/${st.slug}`)).json;
    expect(detail.queue).toHaveLength(20);
    expect(detail.queueTotal).toBe(25);
    expect(detail.queuedKeys).toHaveLength(25);
  });

  it("Choosing how many per page", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex);
    await lineUp(st.id, alex.user.id, 3);
    expect((await call("GET", `/api/radios/${st.slug}/queue?pageSize=100`)).json.pageSize).toBe(100);
    expect((await call("GET", `/api/radios/${st.slug}/queue?pageSize=101`)).status).toBe(400);
    expect((await call("GET", `/api/radios/${st.slug}/queue?page=0`)).status).toBe(400);
  });

  it("Pages everywhere lists grow", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex);
    const at = new Date(Date.now() - 3600_000);
    for (let i = 0; i < 23; i++) {
      const t = await track();
      await db.insert(schema.queueItems).values({ radioId: st.id, trackId: t.id, userId: alex.user.id, status: "played", startedAt: at });
    }
    const history = (await call("GET", `/api/radios/${st.slug}/history?page=2`)).json;
    expect(history).toMatchObject({ total: 23, page: 2 });
    expect(history.items).toHaveLength(3);
    const songs = (await call("GET", `/api/radios/${st.slug}/songs?pageSize=10&page=3`)).json;
    expect(songs).toMatchObject({ total: 23, pageSize: 10 });
    expect(songs.items).toHaveLength(3);
    for (let i = 0; i < 3; i++) await register(`Person ${i}`);
    const users = (await call("GET", "/api/users?pageSize=2&page=2", { cookie: alex.cookie })).json;
    expect(users).toMatchObject({ total: 4, page: 2 });
    expect(users.items).toHaveLength(2);
    const sam = await register("Sam");
    for (let i = 0; i < 3; i++) await call("POST", "/api/feedback", { cookie: sam.cookie, origin: ORIGIN, body: { body: `Feedback number ${i} here` } });
    const inbox = (await call("GET", "/api/admin/feedback?pageSize=2", { cookie: alex.cookie })).json;
    expect(inbox).toMatchObject({ total: 3, unread: 3 });
    expect(inbox.items).toHaveLength(2);
  });
});
