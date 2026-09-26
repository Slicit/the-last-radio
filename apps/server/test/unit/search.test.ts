import { describe, expect, it } from "vitest";
import { toResult } from "../../src/lib/search.js";

// Fixtures trimmed from real `yt-dlp --flat-playlist -J ytsearch/scsearch` output.
describe("search results", () => {
  it("maps a YouTube entry", () => {
    const r = toResult({ id: "dwDns8x3Jb4", title: "Around the World", channel: "Daft Punk - Topic", duration: 429.6, view_count: 93473689 }, "youtube");
    expect(r).toMatchObject({
      sourceKey: "Youtube:dwDns8x3Jb4",
      sourceUrl: "https://www.youtube.com/watch?v=dwDns8x3Jb4",
      artist: "Daft Punk",
      durationSec: 430,
      thumbnailUrl: "https://i.ytimg.com/vi/dwDns8x3Jb4/hqdefault.jpg",
      source: "youtube",
    });
  });

  it("maps a SoundCloud entry with the same key a pasted link gets", () => {
    const r = toResult(
      {
        id: "254112221",
        title: "Around the World",
        uploader: "Daft Punk",
        duration: 429.579,
        view_count: 2140359,
        webpage_url: "https://soundcloud.com/daftpunkofficialmusic/around-the-world",
        thumbnails: [{ url: "https://i1.sndcdn.com/artworks-rwpRsmvbyYhb-0-original.jpg" }],
      },
      "soundcloud",
    );
    expect(r).toMatchObject({
      sourceKey: "Soundcloud:254112221",
      sourceUrl: "https://soundcloud.com/daftpunkofficialmusic/around-the-world",
      artist: "Daft Punk",
      thumbnailUrl: "https://i1.sndcdn.com/artworks-rwpRsmvbyYhb-0-t300x300.jpg",
    });
  });

  it("skips live streams and entries without a length", () => {
    expect(toResult({ id: "x", title: "Live", duration: null }, "youtube")).toBeNull();
    expect(toResult({ id: "x", title: "Live", duration: 10, live_status: "is_live" }, "youtube")).toBeNull();
  });
});
