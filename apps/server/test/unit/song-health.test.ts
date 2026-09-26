import { describe, expect, it } from "vitest";
import { looksGone } from "../../src/lib/gone.js";

// specs/features/song-health.feature: "A song that's gone is marked unavailable"
describe("A song that's gone is marked unavailable", () => {
  it.each([
    "[youtube] BaW_jenozKc: Video unavailable",
    "[youtube] x: Private video. Sign in if you've been granted access",
    "This video has been removed by the uploader",
    "[soundcloud] 123: HTTP Error 404: Not Found",
    "This video is no longer available because the YouTube account associated with this video has been terminated.",
  ])("gone: %s", (m) => expect(looksGone(m)).toBe(true));

  it.each(["HTTP Error 429: Too Many Requests", "Timed out while reading that link", "Connection reset by peer", "Sign in to confirm you're not a bot"])(
    "a hiccup: %s",
    (m) => expect(looksGone(m)).toBe(false),
  );
});
