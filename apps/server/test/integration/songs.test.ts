import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db/index.js";
import { add, call, createStation, register, track } from "./helpers.js";

// specs/features/adding-songs.feature
describe("Adding songs", () => {
  it("Songs have a per-station limit per person", async () => {
    const alex = await register("Alex");
    const sam = await register("Sam");
    const st = await createStation(alex, { rateLimitCount: 3, rateLimitWindowSec: 600 });
    for (let i = 0; i < 3; i++) expect((await add(sam, st.slug, (await track()).id)).status).toBe(201);
    const fourth = await add(sam, st.slug, (await track()).id);
    expect(fourth.status).toBe(429);
    expect(fourth.json.error).toMatch(/^You've added your 3 songs for now\. You can add another in ~\d+ min\.$/);
    const detail = await call("GET", `/api/radios/${st.slug}`, { cookie: sam.cookie });
    expect(detail.json.quota).toMatchObject({ remaining: 0, limit: 3 });
    expect(detail.json.quota.nextSlotAt).toBeTruthy();
  });

  it("admins have no limit", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex, { rateLimitCount: 1 });
    for (let i = 0; i < 3; i++) expect((await add(alex, st.slug, (await track()).id)).status).toBe(201);
  });

  it("A removed song still counts toward the limit", async () => {
    const alex = await register("Alex");
    const sam = await register("Sam");
    const st = await createStation(alex, { rateLimitCount: 1 });
    const first = await add(sam, st.slug, (await track()).id);
    const del = await call("DELETE", `/api/radios/${st.slug}/queue/${first.json.id}`, { cookie: sam.cookie });
    expect(del.status).toBe(200);
    expect((await add(sam, st.slug, (await track()).id)).status).toBe(429);
  });

  it("The same song can't be queued twice", async () => {
    const alex = await register("Alex");
    const sam = await register("Sam");
    const st = await createStation(alex);
    const t = await track({ title: "Feeling Good" });
    expect((await add(alex, st.slug, t.id)).status).toBe(201);
    const again = await add(sam, st.slug, t.id);
    expect(again.status).toBe(409);
    expect(again.json.error).toBe("That song is already in line");
  });

  it("Songs over the station's length limit are refused", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex, { maxTrackSec: 600 });
    const r = await add(alex, st.slug, (await track({ durationSec: 720 })).id);
    expect(r.status).toBe(422);
    expect(r.json.error).toBe("That song is too long for this station (up to 10 min)");
  });

  it("Only public music links are fetched", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex);
    for (const url of ["http://10.0.0.5/song.mp3", "http://mediamtx:9997/v3/paths/list", "http://169.254.169.254/latest/meta-data/"]) {
      const r = await call("POST", `/api/radios/${st.slug}/queue`, { cookie: alex.cookie, body: { url } });
      expect(r.status).toBe(422);
      expect(r.json.error).toBe("That link points to a private address");
    }
    const creds = await call("POST", `/api/radios/${st.slug}/queue`, { cookie: alex.cookie, body: { url: "https://u:p@www.youtube.com/watch?v=x" } });
    expect(creds.json.error).toBe("Links with credentials aren't allowed");
  });

  it("Adding while a station is closed", async () => {
    const alex = await register("Alex");
    // A one-minute window at 03:00 on no day but Sunday-or-so: effectively closed now for this test run.
    const st = await createStation(alex, { hoursEnabled: true, hoursDays: [0], hoursStart: "03:00", hoursEnd: "03:01", timezone: "Pacific/Kiritimati" });
    const detail = await call("GET", `/api/radios/${st.slug}`);
    if (detail.json.radio.hours.open) return; // the one minute a week it's open
    const r = await add(alex, st.slug, (await track()).id);
    expect(r.status).toBe(201);
    const [row] = await db.select().from(schema.queueItems).where(eq(schema.queueItems.id, r.json.id));
    expect(row.status).toBe("queued");
  });

  it("the confirmation says where the song is in line", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex);
    expect((await add(alex, st.slug, (await track()).id)).json.position).toBe(1);
    expect((await add(alex, st.slug, (await track()).id)).json.position).toBe(2);
  });
});

// specs/features/adding-songs.feature
describe("SoundCloud samples", () => {
  it("SoundCloud samples are marked", async () => {
    const alex = await register("Alex");
    const st = await createStation(alex);
    const sample = await track({ sourceKey: "Soundcloud:30s", sourceUrl: "https://soundcloud.com/x/sample", title: "Get Lucky", durationSec: 30, isPreview: true });
    const full = await track({ title: "Full song" });
    expect((await add(alex, st.slug, sample.id)).status).toBe(201);
    expect((await add(alex, st.slug, full.id)).status).toBe(201);
    const queue = (await call("GET", `/api/radios/${st.slug}/queue`)).json.items;
    expect(queue.map((q: any) => [q.track.title, q.track.isPreview])).toEqual([["Get Lucky", true], ["Full song", false]]);
    // Song records and exports keep it too.
    await db.update(schema.queueItems).set({ status: "played", startedAt: new Date(), endedAt: new Date() });
    const songs = (await call("GET", `/api/radios/${st.slug}/songs`)).json.items;
    expect(songs.find((s: any) => s.track.title === "Get Lucky").track.isPreview).toBe(true);
    const file = (await call("GET", `/api/radios/${st.slug}/export`, { cookie: alex.cookie })).json;
    expect(file.songs.find((s: any) => s.title === "Get Lucky").isPreview).toBe(true);
  });
});
