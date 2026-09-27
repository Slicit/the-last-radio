import { beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:net";
import { resetYoutubeHealth, searchWithFallback, youtubeReachable, type SearchResult } from "../../src/lib/search.js";
import { AbortedError, ProbeError } from "../../src/lib/ytdlp.js";

const song = (source: "youtube" | "soundcloud") => ({ title: `from ${source}`, source }) as unknown as SearchResult;

/** A fake search that records what it was asked, and fails YouTube when told to. */
function fake(youtube: "ok" | "fail" | "abort" = "ok") {
  const calls: string[] = [];
  const search = async (_q: string, source: "youtube" | "soundcloud" = "youtube") => {
    calls.push(source);
    if (source === "youtube" && youtube === "fail") throw new ProbeError("Unable to connect to proxy");
    if (source === "youtube" && youtube === "abort") throw new AbortedError("aborted");
    return [song(source)];
  };
  return { calls, search };
}

// specs/features/adding-songs.feature: "Search still answers when YouTube can't be reached"
describe("Search still answers when YouTube can't be reached", () => {
  beforeEach(() => resetYoutubeHealth());

  it("searches YouTube when it's reachable", async () => {
    const f = fake();
    const r = await searchWithFallback("daft punk", "youtube", undefined, { search: f.search, reachable: async () => true });
    expect(r).toEqual({ results: [song("youtube")], source: "youtube" });
  });

  it("goes straight to SoundCloud when the YouTube proxy doesn't answer", async () => {
    const f = fake();
    const r = await searchWithFallback("daft punk", "youtube", undefined, { search: f.search, reachable: async () => false });
    expect(r).toEqual({ results: [song("soundcloud")], source: "soundcloud", fallbackFrom: "youtube" });
    expect(f.calls).toEqual(["soundcloud"]);
  });

  it("falls back when a YouTube search fails, then rests YouTube for a minute", async () => {
    let now = 1_000_000;
    const failing = fake("fail");
    const r = await searchWithFallback("daft punk", "youtube", undefined, { search: failing.search, reachable: async () => true, now: () => now });
    expect(r.fallbackFrom).toBe("youtube");
    expect(failing.calls).toEqual(["youtube", "soundcloud"]);

    const next = fake();
    now += 30_000;
    await searchWithFallback("air", "youtube", undefined, { search: next.search, reachable: async () => true, now: () => now });
    expect(next.calls).toEqual(["soundcloud"]); // still resting
    now += 31_000;
    await searchWithFallback("air", "youtube", undefined, { search: next.search, reachable: async () => true, now: () => now });
    expect(next.calls).toEqual(["soundcloud", "youtube"]); // tried again
  });

  it("doesn't fall back when the person just kept typing", async () => {
    const f = fake("abort");
    await expect(searchWithFallback("daft", "youtube", undefined, { search: f.search, reachable: async () => true })).rejects.toBeInstanceOf(AbortedError);
    expect(f.calls).toEqual(["youtube"]);
  });

  it("SoundCloud searches never touch YouTube", async () => {
    const f = fake("fail");
    const r = await searchWithFallback("x", "soundcloud", undefined, { search: f.search, reachable: async () => false });
    expect(r).toEqual({ results: [song("soundcloud")], source: "soundcloud" });
  });

  it("checks the proxy with a quick connection", async () => {
    expect(await youtubeReachable("")).toBe(true); // no proxy: nothing to check
    const server = createServer((s) => s.end()).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    expect(await youtubeReachable(`http://127.0.0.1:${port}`)).toBe(true);
    server.close();
    resetYoutubeHealth();
    expect(await youtubeReachable(`http://127.0.0.1:${port}`)).toBe(false); // nobody listening
  });
});
