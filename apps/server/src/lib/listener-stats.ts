import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { listenerCount } from "./listeners.js";

const { listenerSamples, radios } = schema;

export const SAMPLE_MS = 5 * 60_000;

/** The 5-minute slot a moment falls in, so samples line up across stations and restarts. */
export const slotOf = (now: number) => new Date(Math.floor(now / SAMPLE_MS) * SAMPLE_MS);

/** Saves how many people are listening to each station on air right now. */
export async function sampleListeners(now = Date.now()) {
  const active = await db.select({ id: radios.id }).from(radios).where(eq(radios.isActive, true));
  if (!active.length) return 0;
  const at = slotOf(now);
  await db
    .insert(listenerSamples)
    .values(active.map((r) => ({ radioId: r.id, at, listeners: listenerCount(r.id) })))
    .onConflictDoNothing();
  return active.length;
}

/** Runs sampleListeners on every 5-minute mark (:00, :05, …). */
export function startListenerSampling() {
  const tick = () => sampleListeners().catch((e) => console.error("listener stats:", e));
  setTimeout(() => {
    void tick();
    setInterval(tick, SAMPLE_MS);
  }, SAMPLE_MS - (Date.now() % SAMPLE_MS) + 1000);
}

// Charts show at most three months; each range gets a bucket size that keeps
// them to a few hundred points.
export const RANGES = {
  "24h": { days: 1, bucketSec: 5 * 60 },
  "7d": { days: 7, bucketSec: 30 * 60 },
  "30d": { days: 30, bucketSec: 2 * 3600 },
  "90d": { days: 90, bucketSec: 6 * 3600 },
} as const;
export type Range = keyof typeof RANGES;

type Point = { t: string; avg: number; peak: number };
type Row = { radio_id?: string; t: Date | string; avg: number; peak: number };

const point = (r: Row): Point => ({ t: new Date(r.t).toISOString(), avg: Math.round(Number(r.avg) * 10) / 10, peak: Number(r.peak) });

const summary = (points: Point[]) => {
  const top = points.reduce<Point | null>((best, p) => (!best || p.peak > best.peak ? p : best), null);
  const avg = points.length ? points.reduce((n, p) => n + p.avg, 0) / points.length : 0;
  return { peak: top?.peak ?? 0, peakAt: top?.t ?? null, avg: Math.round(avg * 10) / 10 };
};

/** Average and peak listeners per bucket, for all stations together and for each. */
export async function listenerSeries(range: Range, now = Date.now()) {
  const { days, bucketSec } = RANGES[range];
  const from = new Date(now - days * 86400_000).toISOString();
  const bucket = sql`to_timestamp(floor(extract(epoch from at) / ${bucketSec}) * ${bucketSec})`;

  const [perRadio, total, stations] = await Promise.all([
    db.execute<Row>(sql`
      select radio_id, ${bucket} as t, avg(listeners) as avg, max(listeners) as peak
      from listener_samples where at >= ${from}::timestamptz
      group by radio_id, t order by t`),
    // All stations: add up each 5-minute sample first, then bucket.
    db.execute<Row>(sql`
      select ${bucket} as t, avg(total) as avg, max(total) as peak
      from (select at, sum(listeners) as total from listener_samples where at >= ${from}::timestamptz group by at) s
      group by t order by t`),
    db.select({ id: radios.id, slug: radios.slug, name: radios.name, isPrivate: radios.isPrivate }).from(radios).orderBy(radios.name),
  ]);

  const byRadio = new Map<string, Point[]>();
  for (const r of perRadio) {
    const list = byRadio.get(r.radio_id!) ?? [];
    list.push(point(r));
    byRadio.set(r.radio_id!, list);
  }
  const all = [...total].map(point);
  return {
    range,
    from,
    to: new Date(now).toISOString(),
    bucketSec,
    all: { points: all, ...summary(all) },
    stations: stations
      .filter((s) => byRadio.has(s.id))
      .map((s) => {
        const points = byRadio.get(s.id)!;
        return { station: s, points, ...summary(points) };
      }),
  };
}
