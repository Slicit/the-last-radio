import { describe, expect, it } from "vitest";
import { RateLimiter } from "../../src/lib/rate-limit.js";

describe("RateLimiter", () => {
  it("allows up to the limit, then says how long to wait", () => {
    const rl = new RateLimiter(3, 60_000);
    const t = 1_000_000;
    expect([rl.hit("a", t), rl.hit("a", t), rl.hit("a", t)]).toEqual([0, 0, 0]);
    expect(rl.hit("a", t + 10_000)).toBe(50);
  });

  it("counts keys separately and resets after the window", () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.hit("a", 0)).toBe(0);
    expect(rl.hit("b", 0)).toBe(0);
    expect(rl.hit("a", 500)).toBeGreaterThan(0);
    expect(rl.hit("a", 1000)).toBe(0);
  });

  it("blocked() peeks without counting, reset() clears", () => {
    const rl = new RateLimiter(2, 1000);
    rl.hit("k", 0);
    expect(rl.blocked("k", 0)).toBe(0);
    rl.hit("k", 0);
    expect(rl.blocked("k", 0)).toBe(1);
    rl.reset("k");
    expect(rl.blocked("k", 0)).toBe(0);
  });
});
