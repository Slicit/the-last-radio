import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

/**
 * Fixed-window counters kept in memory. There is one api process, so this is
 * exact; with several, move the counters to Postgres or Redis.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  /** Counts a hit; returns seconds to wait when over the limit, else 0. */
  hit(key: string, now = Date.now()): number {
    let e = this.hits.get(key);
    if (!e || e.resetAt <= now) {
      e = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, e);
      if (this.hits.size > 50_000) this.sweep(now);
    }
    e.count++;
    return e.count > this.limit ? Math.ceil((e.resetAt - now) / 1000) : 0;
  }

  /** Whether `key` is currently blocked, without counting a hit. */
  blocked(key: string, now = Date.now()): number {
    const e = this.hits.get(key);
    return e && e.resetAt > now && e.count >= this.limit ? Math.ceil((e.resetAt - now) / 1000) : 0;
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  private sweep(now: number) {
    for (const [k, e] of this.hits) if (e.resetAt <= now) this.hits.delete(k);
  }
}

/** The caller's IP as nginx saw it (the api container is only reachable through nginx). */
export function clientIp(c: Context): string {
  return c.req.header("x-real-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export function tooMany(c: Context, waitSec: number, message: string): never {
  c.header("Retry-After", String(waitSec));
  const mins = Math.ceil(waitSec / 60);
  throw new HTTPException(429, { message: `${message} Try again in ${waitSec < 90 ? `${waitSec} s` : `${mins} min`}.` });
}

/** Middleware: at most `limit` requests per `windowMs` per key (the client IP by default). */
export function rateLimit(opts: {
  limit: number;
  windowMs: number;
  message?: string;
  key?: (c: Context) => string | null;
}) {
  const limiter = new RateLimiter(opts.limit, opts.windowMs);
  return createMiddleware(async (c, next) => {
    const key = opts.key ? opts.key(c) : clientIp(c);
    if (key) {
      const wait = limiter.hit(key);
      if (wait) tooMany(c, wait, opts.message ?? "Slow down a little.");
    }
    await next();
  });
}
