import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { setArtFetcher } from "../../src/lib/art-cache.js";
import { app, call, track } from "./helpers.js";

const image = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#c33" } }).jpeg().toBuffer();
const art = (key: string) => call("GET", `/api/art/${encodeURIComponent(key)}`);

// specs/features/privacy.feature
describe("Song artwork", () => {
  afterEach(() => setArtFetcher(null));

  it("Song artwork comes from our own cache", async () => {
    let fetched = 0;
    const big = await image(1280, 720);
    setArtFetcher(async () => {
      fetched++;
      return big;
    });
    const t = await track({ sourceKey: `Youtube:art-${Date.now()}`, thumbnailUrl: "https://i.ytimg.com/vi/x/hqdefault.jpg" });

    const res = await app.fetch(new Request(`http://radio.test/api/art/${encodeURIComponent(t.sourceKey)}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 480, 270]); // shrunk, same shape
    expect((await art(t.sourceKey)).status).toBe(200);
    expect(fetched).toBe(1); // the second time, straight from the cache
  });

  it("an image that can't be fetched gets the placeholder, and waits a day before trying again", async () => {
    let tries = 0;
    setArtFetcher(async () => {
      tries++;
      throw new Error("HTTP 404");
    });
    const t = await track({ sourceKey: `Youtube:gone-${Date.now()}`, thumbnailUrl: "https://i.ytimg.com/vi/gone/hqdefault.jpg" });
    expect((await art(t.sourceKey)).status).toBe(404);
    expect((await art(t.sourceKey)).status).toBe(404);
    expect(tries).toBe(1);
    // Songs without an image, and unknown songs: the placeholder, without fetching anything.
    const bare = await track({ sourceKey: `Youtube:bare-${Date.now()}`, thumbnailUrl: null });
    expect((await art(bare.sourceKey)).status).toBe(404);
    expect((await art("Youtube:never-heard-of-it")).status).toBe(404);
    expect(tries).toBe(1);
  });

  it("never fetches internal addresses", async () => {
    // The real fetcher, pointed at the database's internal name.
    const t = await track({ sourceKey: `Youtube:ssrf-${Date.now()}`, thumbnailUrl: "http://postgres:5432/x.jpg" });
    expect((await art(t.sourceKey)).status).toBe(404);
    const local = await track({ sourceKey: `Youtube:ssrf2-${Date.now()}`, thumbnailUrl: "http://127.0.0.1/x.jpg" });
    expect((await art(local.sourceKey)).status).toBe(404);
  });

  it("decodes inline artwork without fetching", async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#39f" } }).png().toBuffer();
    const t = await track({ sourceKey: `Soundcloud:inline-${Date.now()}`, thumbnailUrl: `data:image/png;base64,${png.toString("base64")}` });
    expect((await art(t.sourceKey)).status).toBe(200);
  });
});

describe("Backfilling artwork", () => {
  afterEach(() => setArtFetcher(null));

  it("fills the cache for every song with artwork, once", async () => {
    const { backfillArt } = await import("../../src/lib/art-cache.js");
    const img = await image(300, 300);
    let fetched = 0;
    setArtFetcher(async (url) => {
      fetched++;
      if (url.includes("broken")) throw new Error("HTTP 404");
      return img;
    });
    const stamp = Date.now();
    await track({ sourceKey: `Youtube:bf1-${stamp}`, thumbnailUrl: "https://i.ytimg.com/vi/bf1/hq.jpg" });
    await track({ sourceKey: `Youtube:bf2-${stamp}`, thumbnailUrl: "https://i.ytimg.com/vi/bf2/hq.jpg" });
    await track({ sourceKey: `Youtube:bf3-${stamp}`, thumbnailUrl: "https://i.ytimg.com/vi/broken/hq.jpg" });
    await track({ sourceKey: `Youtube:bf4-${stamp}`, thumbnailUrl: null }); // nothing to fetch

    expect(await backfillArt()).toEqual({ total: 3, alreadyCached: 0, fetched: 2, missing: 1 });
    // Again: nothing new to fetch; the broken one waits for its retry time...
    expect(await backfillArt()).toEqual({ total: 3, alreadyCached: 2, fetched: 0, missing: 1 });
    expect(fetched).toBe(3);
    // ...unless asked to retry now.
    expect(await backfillArt({ retryMissing: true })).toEqual({ total: 3, alreadyCached: 2, fetched: 0, missing: 1 });
    expect(fetched).toBe(4);
  });
});
