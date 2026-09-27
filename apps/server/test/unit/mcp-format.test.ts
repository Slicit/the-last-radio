import { describe, expect, it } from "vitest";
import { fmtDuration, itemLine, nextOpeningText, ordinal, when } from "../../src/mcp/format.js";

describe("MCP text formatting", () => {
  it("durations and relative starts", () => {
    expect(fmtDuration(45)).toBe("45s");
    expect(fmtDuration(225)).toBe("3:45");
    expect(fmtDuration(3900)).toBe("1h05");
    expect(when(10)).toBe("now");
    expect(when(240)).toBe("in 4 min");
  });

  it("ordinals", () => {
    expect([1, 2, 3, 4, 11, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "22nd"]);
  });

  it("names Alfred as the adder of fill-in songs", () => {
    const track = { title: "Feeling Good", artist: "Nina Simone", durationSec: 183 };
    expect(itemLine({ isFill: true, track, pushedBy: null })).toBe('"Feeling Good" by Nina Simone (3:03), added by Alfred (the auto-DJ)');
    expect(itemLine({ isFill: false, track, pushedBy: { displayName: "Sam" } })).toContain("added by Sam");
    expect(itemLine({ isFill: false, track: { ...track, durationSec: 30, isPreview: true }, pushedBy: { displayName: "Sam" } })).toBe(
      '"Feeling Good" by Nina Simone (only a 30-second SAMPLE), added by Sam',
    );
  });

  it("says when a closed station opens", () => {
    expect(nextOpeningText({ open: false, next: { inDays: 1, weekday: 2, time: "08:00" }, closesAt: null })).toBe(
      "opens tomorrow at 08:00 (station time)",
    );
  });
});
