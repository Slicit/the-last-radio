import { createApp } from "../../src/app.js";
import { db, schema } from "../../src/db/index.js";
import { heartbeat } from "../../src/lib/listeners.js";

export const app = createApp({ log: false });
export const ORIGIN = "http://radio.test";

// Every test gets its own client IP so in-memory rate limits never leak between tests.
let ipSeq = 0;
export const freshIp = () => `10.77.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

type Opts = { body?: unknown; cookie?: string; token?: string; ip?: string; origin?: string; headers?: Record<string, string> };

export async function call(method: string, path: string, o: Opts = {}) {
  const headers: Record<string, string> = { "x-real-ip": o.ip ?? freshIp(), ...(o.headers ?? {}) };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.cookie) headers.cookie = o.cookie;
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  if (o.origin) headers.origin = o.origin;
  const res = await app.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers,
      body: o.body === undefined ? undefined : typeof o.body === "string" ? o.body : JSON.stringify(o.body),
    }),
  );
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, headers: res.headers };
}

let userSeq = 0;
/** Registers someone; the first account in a test becomes the admin. */
export async function register(displayName = `User ${++userSeq}`, password = "a-good-password") {
  const email = `${displayName.toLowerCase().replace(/\W+/g, ".")}.${++userSeq}@radio.test`;
  const r = await call("POST", "/api/auth/register", { body: { email, password, displayName, acceptPrivacy: true } });
  if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.json)}`);
  const cookie = r.headers.get("set-cookie")!.split(";")[0];
  return { cookie, user: r.json.user as { id: string; role: string; email: string }, email, password };
}

export type Person = Awaited<ReturnType<typeof register>>;

export async function createStation(admin: Person, body: Record<string, unknown> = {}) {
  const slug = (body.slug as string) ?? `st-${++userSeq}`;
  const r = await call("POST", "/api/radios", { cookie: admin.cookie, body: { slug, name: `Station ${slug}`, ...body } });
  if (r.status !== 201) throw new Error(`create station failed: ${JSON.stringify(r.json)}`);
  return r.json.radio as { id: string; slug: string };
}

let trackSeq = 0;
export async function track(over: Partial<typeof schema.tracks.$inferInsert> = {}) {
  const n = ++trackSeq;
  const [t] = await db
    .insert(schema.tracks)
    .values({
      sourceKey: `Youtube:t${n}`,
      sourceUrl: `https://www.youtube.com/watch?v=t${n}`,
      title: `Song ${n}`,
      artist: "Tester",
      durationSec: 200,
      ...over,
    })
    .returning();
  return t;
}

export const add = (who: Person, slug: string, trackId: string) =>
  call("POST", `/api/radios/${slug}/queue`, { cookie: who.cookie, body: { trackId } });

/** Puts a queued item on air, as the broadcaster would. */
export async function putOnAir(itemId: string, startedAt = new Date()) {
  const { eq } = await import("drizzle-orm");
  await db.update(schema.queueItems).set({ status: "playing", startedAt }).where(eq(schema.queueItems.id, itemId));
}

/** Registers `who` (or an anonymous id) as listening to a station. */
export function listening(radioId: string, listenerId: string, userId: string | null, ip = "10.1.1.1") {
  return heartbeat(radioId, listenerId, userId, ip);
}

/** A seeded random source (mulberry32), so weighted draws in tests come out the same every run. */
export function seededRandom(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
