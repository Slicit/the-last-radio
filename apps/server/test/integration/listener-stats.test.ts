import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db/index.js";
import { sampleListeners, SAMPLE_MS, slotOf } from "../../src/lib/listener-stats.js";
import { call, createStation, listening, register } from "./helpers.js";

const { listenerSamples, radios } = schema;

// specs/features/listener-stats.feature
describe("Listener stats", () => {
  it("Listeners are counted every 5 minutes", async () => {
    const alex = await register("Alex");
    const main = await createStation(alex);
    const quiet = await createStation(alex);
    const off = await createStation(alex);
    await db.update(radios).set({ isActive: false }).where(eq(radios.id, off.id));
    listening(main.id, "listener-a1", alex.user.id, "10.9.0.1");
    listening(main.id, "listener-a2", null, "10.9.0.2");

    const now = Date.parse("2026-09-26T20:07:31Z");
    await sampleListeners(now);
    await sampleListeners(now + 60_000); // same slot: counted once
    const rows = await db.select().from(listenerSamples);
    const of = (id: string) => rows.filter((r) => r.radioId === id);
    expect(of(main.id)).toEqual([{ radioId: main.id, at: new Date("2026-09-26T20:05:00Z"), listeners: 2 }]);
    expect(of(quiet.id).map((r) => r.listeners)).toEqual([0]);
    expect(of(off.id)).toEqual([]); // off the air: not counted
    expect(slotOf(now + SAMPLE_MS).toISOString()).toBe("2026-09-26T20:10:00.000Z");
  });

  it("Admins see listeners over time", async () => {
    const alex = await register("Alex");
    const sam = await register("Sam");
    const a = await createStation(alex);
    const b = await createStation(alex);
    // Two hours ago, in one 30-minute bucket: a has 2 then 4, b has 1 then 3.
    const base = Math.floor((Date.now() - 2 * 3600_000) / 1800_000) * 1800_000;
    await db.insert(listenerSamples).values([
      { radioId: a.id, at: new Date(base), listeners: 2 },
      { radioId: a.id, at: new Date(base + SAMPLE_MS), listeners: 4 },
      { radioId: b.id, at: new Date(base), listeners: 1 },
      { radioId: b.id, at: new Date(base + SAMPLE_MS), listeners: 3 },
      // Four months ago: kept, but outside every chart.
      { radioId: a.id, at: new Date(Date.now() - 120 * 86400_000), listeners: 50 },
    ]);

    const r = await call("GET", "/api/admin/listeners", { cookie: alex.cookie });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ range: "7d", bucketSec: 1800 });
    const t = new Date(base).toISOString();
    // All stations: 3 then 7 listeners in that bucket.
    expect(r.json.all).toEqual({ points: [{ t, avg: 5, peak: 7 }], peak: 7, peakAt: t, avg: 5 });
    const station = (id: string) => r.json.stations.find((s: any) => s.station.id === id);
    expect(station(a.id)).toMatchObject({ points: [{ t, avg: 3, peak: 4 }], peak: 4 });
    expect(station(b.id)).toMatchObject({ points: [{ t, avg: 2, peak: 3 }], peak: 3 });

    const long = await call("GET", "/api/admin/listeners?range=90d", { cookie: alex.cookie });
    expect(long.json.bucketSec).toBe(6 * 3600);
    expect(long.json.all.peak).toBe(7); // the 4-month-old 50 isn't shown
    expect((await db.select().from(listenerSamples).where(eq(listenerSamples.listeners, 50))).length).toBe(1); // but kept

    expect((await call("GET", "/api/admin/listeners?range=1y", { cookie: alex.cookie })).status).toBe(400);
    expect((await call("GET", "/api/admin/listeners", { cookie: sam.cookie })).status).toBe(403);
    expect((await call("GET", "/api/admin/listeners")).status).toBe(401);
  });
});
