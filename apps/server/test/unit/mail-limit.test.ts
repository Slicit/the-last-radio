import { describe, expect, it } from "vitest";
import { RecipientLimiter } from "../../src/lib/mail.js";

const MIN = 60_000;

// specs/features/private-stations.feature: "Confirming an email"
describe("emails per address", () => {
  it("allows 3, blocks the 4th, and unlocks 30 minutes after the last", () => {
    const l = new RecipientLimiter();
    const t0 = 1_000_000;
    for (const m of [0, 5, 10]) {
      expect(l.wait("sam@example.com", t0 + m * MIN)).toBe(0);
      l.record("sam@example.com", t0 + m * MIN);
    }
    expect(l.wait("sam@example.com", t0 + 11 * MIN)).toBe(29 * 60); // until 10 + 30 min
    expect(l.wait("SAM@Example.com ", t0 + 39 * MIN)).toBe(60); // case and spaces don't matter
    expect(l.wait("sam@example.com", t0 + 40 * MIN)).toBe(0);
    expect(l.wait("other@example.com", t0 + 11 * MIN)).toBe(0); // per address
  });

  it("only counts emails from the last 30 minutes", () => {
    const l = new RecipientLimiter();
    l.record("kim@example.com", 0);
    l.record("kim@example.com", 20 * MIN);
    l.record("kim@example.com", 31 * MIN); // the first one has aged out
    expect(l.wait("kim@example.com", 32 * MIN)).toBe(0);
  });
});
