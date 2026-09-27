import { describe, expect, it } from "vitest";
import { toResult } from "../../src/lib/search.js";
import { previewOnly, proxyArgs } from "../../src/lib/ytdlp.js";

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
      isPreview: false,
    });
  });

  // specs/features/adding-songs.feature: "SoundCloud samples are marked"
  it("marks SoundCloud's 30-second samples", () => {
    // Real: SoundCloud search reports Go+ songs it only previews as exactly 30 s.
    const entry = { id: "1", title: "Get Lucky", uploader: "Daft Punk", duration: 30.0, webpage_url: "https://soundcloud.com/daftpunkofficialmusic/get-lucky" };
    expect(toResult(entry, "soundcloud")?.isPreview).toBe(true);
    expect(toResult({ ...entry, duration: 246.381 }, "soundcloud")?.isPreview).toBe(false);
    expect(toResult({ ...entry, duration: 30 }, "youtube")?.isPreview).toBe(false); // YouTube has no samples
    // A pasted link reads the formats: SoundCloud offers only "…_preview" ones for samples.
    expect(previewOnly([{ format_id: "hls_mp3_1_0_preview" }, { format_id: "http_mp3_1_0_preview" }])).toBe(true);
    expect(previewOnly([{ format_id: "hls_mp3_0_0" }, { format_id: "http_mp3_0_0" }, { format_id: "hls_aac_96k" }])).toBe(false);
    expect(previewOnly([])).toBe(false);
  });

  it("skips live streams and entries without a length", () => {
    expect(toResult({ id: "x", title: "Live", duration: null }, "youtube")).toBeNull();
    expect(toResult({ id: "x", title: "Live", duration: 10, live_status: "is_live" }, "youtube")).toBeNull();
  });
});

describe("YouTube proxy", () => {
  const P = "http://10.66.0.2:8888";
  it("routes only YouTube links and searches through YOUTUBE_PROXY", () => {
    for (const target of ["ytsearch8:daft punk", "https://www.youtube.com/watch?v=abc", "https://youtu.be/abc", "https://music.youtube.com/watch?v=abc"]) {
      expect(proxyArgs(["-J", "--", target], P)).toEqual(["--proxy", P]);
    }
    for (const target of ["scsearch8:daft punk", "https://soundcloud.com/a/b", "https://notyoutube.com/watch?v=abc", "https://evil.example/https://youtube.com/"]) {
      expect(proxyArgs(["-J", "--", target], P)).toEqual([]);
    }
    expect(proxyArgs(["--", "https://youtu.be/abc"], "")).toEqual([]);
  });
});
