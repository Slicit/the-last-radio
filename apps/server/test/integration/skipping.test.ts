import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../../src/db/index.js";
import { add, call, createStation, listening, putOnAir, register, track } from "./helpers.js";

const status = async (id: string) => (await db.query.queueItems.findFirst({ where: eq(schema.queueItems.id, id) }))!;

async function onAirSong() {
  const alex = await register("Alex");
  const sam = await register("Sam");
  const kim = await register("Kim");
  const st = await createStation(alex, { skipVotePercent: 50 });
  const item = (await add(kim, st.slug, (await track()).id)).json;
  await putOnAir(item.id);
  return { alex, sam, kim, st, itemId: item.id as string };
}
const vote = (who: { cookie: string }, slug: string, itemId: string) =>
  call("POST", `/api/radios/${slug}/votes`, { cookie: who.cookie, body: { itemId } });

// specs/features/skipping.feature
describe("Skipping and downvotes", () => {
  afterEach(() => vi.useRealTimers());

  it("An admin skips the song on air", async () => {
    const { alex, st, itemId } = await onAirSong();
    expect((await call("POST", `/api/radios/${st.slug}/skip`, { cookie: alex.cookie })).json).toEqual({ skipped: true });
    expect(await status(itemId)).toMatchObject({ status: "skipped", skipReason: "admin" });
  });

  it("Skipping your own song", async () => {
    const { kim, st, itemId } = await onAirSong();
    expect((await call("POST", `/api/radios/${st.slug}/skip`, { cookie: kim.cookie })).json.skipped).toBe(true);
    expect((await status(itemId)).skipReason).toBe("owner");
  });

  it("Players can't skip other people's songs", async () => {
    const { sam, st } = await onAirSong();
    const r = await call("POST", `/api/radios/${st.slug}/skip`, { cookie: sam.cookie });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe("Only the person who added this song can skip it. Vote instead!");
  });

  it("Only people listening can vote", async () => {
    const { sam, st, itemId } = await onAirSong();
    const before = await vote(sam, st.slug, itemId);
    expect(before.status).toBe(403);
    expect(before.json.error).toMatch(/^Tune in to vote/);
    const detail = await call("GET", `/api/radios/${st.slug}`, { cookie: sam.cookie });
    expect(detail.json.skip.canVote).toBe(false);
    listening(st.id, "sam-browser", sam.user.id);
    expect((await vote(sam, st.slug, itemId)).status).toBe(200);
  });

  it("Enough votes skip the song", async () => {
    const { alex, sam, st, itemId } = await onAirSong();
    listening(st.id, "l-sam", sam.user.id);
    listening(st.id, "l-alex", alex.user.id);
    listening(st.id, "l-anon1", null);
    listening(st.id, "l-anon2", null);
    expect((await call("GET", `/api/radios/${st.slug}`)).json.skip.needed).toBe(2);
    expect((await vote(sam, st.slug, itemId)).json.skipped).toBe(false);
    expect((await vote(alex, st.slug, itemId)).json.skipped).toBe(true);
    expect(await status(itemId)).toMatchObject({ status: "skipped", skipReason: "votes" });
  });

  it("A vote can be taken back, and counts once", async () => {
    const { sam, st, itemId } = await onAirSong();
    for (const id of ["l-sam", "a1", "a2", "a3"]) listening(st.id, id, id === "l-sam" ? sam.user.id : null);
    await vote(sam, st.slug, itemId);
    await vote(sam, st.slug, itemId);
    expect((await call("GET", `/api/radios/${st.slug}`, { cookie: sam.cookie })).json.skip).toMatchObject({ votes: 1, voted: true });
    await call("DELETE", `/api/radios/${st.slug}/votes/${itemId}`, { cookie: sam.cookie });
    expect((await call("GET", `/api/radios/${st.slug}`, { cookie: sam.cookie })).json.skip).toMatchObject({ votes: 0, voted: false });
  });

  it("Listeners leaving can tip the vote", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
    const { sam, st, itemId } = await onAirSong();
    for (const id of ["listener-sam", "anon-one", "anon-two"]) listening(st.id, id, id === "listener-sam" ? sam.user.id : null);
    expect((await vote(sam, st.slug, itemId)).json.skipped).toBe(false); // 1 of 2 needed
    vi.setSystemTime(new Date("2026-09-26T12:00:50Z")); // the anonymous listeners are gone
    const beat = await call("POST", `/api/radios/${st.slug}/listen`, { cookie: sam.cookie, body: { listenerId: "listener-sam" } });
    expect(beat.status).toBe(200);
    expect((await status(itemId)).skipReason).toBe("votes");
  });

  it("Votes are tied to the song they were cast on", async () => {
    const { sam, st } = await onAirSong();
    listening(st.id, "l-sam", sam.user.id);
    const r = await vote(sam, st.slug, "00000000-0000-4000-8000-000000000000");
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("That song already ended");
  });

  it("Voting can be turned off per station", async () => {
    const { alex, sam, st, itemId } = await onAirSong();
    await call("PATCH", `/api/radios/${st.slug}`, { cookie: alex.cookie, body: { skipVotePercent: 0 } });
    listening(st.id, "l-sam", sam.user.id);
    const r = await vote(sam, st.slug, itemId);
    expect(r.json.error).toBe("Skip votes are off on this station");
  });
});
