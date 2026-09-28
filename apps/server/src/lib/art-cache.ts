import { mkdir, readFile, readdir, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { env } from "./env.js";
import { knownFromKey } from "./search.js";
import { assertPublicUrl } from "./url-safety.js";

/**
 * Song artwork, served from our own address so listeners' browsers never
 * contact YouTube, SoundCloud and co. Each image is fetched once by the
 * server, shrunk to a small WebP and kept next to the audio cache
 * (CACHE_DIR/thumbs). Like songs, the least recently shown are evicted when
 * the cache is full, and fetched again when needed. An image that can't be
 * fetched gets the placeholder, and is tried again after a day.
 */

const MAX_SIDE = 480;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const RETRY_MISSING_MS = 24 * 3600_000;

const dir = () => path.join(env.CACHE_DIR, "thumbs");
const maxBytes = () => Number(process.env.ART_CACHE_MAX_BYTES ?? 256 * 1024 ** 2);
const fileFor = (key: string) => path.join(dir(), createHash("sha256").update(key).digest("hex").slice(0, 32));

type Fetcher = (url: string) => Promise<Buffer>;

/** Fetches an image from a public address: no internal hosts, even after redirects; images only; size and time capped. */
async function fetchPublicImage(url: string): Promise<Buffer> {
  // Artwork given inline (imported or demo data): nothing to fetch.
  const inline = /^data:image\/[\w.+-]+;base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (inline) {
    const buf = Buffer.from(inline[1], "base64");
    if (buf.length > MAX_SOURCE_BYTES) throw new Error("Image too large");
    return buf;
  }
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!(res.headers.get("content-type") ?? "").startsWith("image/")) throw new Error("Not an image");
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_SOURCE_BYTES) throw new Error("Image too large");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_SOURCE_BYTES) throw new Error("Image too large");
    return buf;
  }
  throw new Error("Too many redirects");
}

let fetcher: Fetcher = fetchPublicImage;
/** Tests: fetch images some other way (the test network has no internet). */
export const setArtFetcher = (f: Fetcher | null) => void (fetcher = f ?? fetchPublicImage);

/** A small WebP, at most MAX_SIDE on its longest side, metadata stripped. */
async function shrink(buf: Buffer): Promise<Buffer> {
  return sharp(buf, { limitInputPixels: 40_000_000, animated: false, failOn: "error" })
    .rotate()
    .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();
}

/** Where the original image of a song lives: its record here, or a recent search result. */
async function sourceOf(key: string): Promise<string | null> {
  const [t] = await db.select({ url: schema.tracks.thumbnailUrl }).from(schema.tracks).where(eq(schema.tracks.sourceKey, key)).limit(1);
  if (t) return t.url;
  return knownFromKey(key)?.thumbnailUrl ?? null;
}

const inflight = new Map<string, Promise<Buffer | null>>();

/** The cached artwork for a song (by source key), fetching it if needed; null means "use the placeholder". */
export async function artFor(key: string): Promise<Buffer | null> {
  const file = fileFor(key);
  const cached = await readFile(file).catch(() => null);
  if (cached) {
    const now = new Date();
    await utimes(file, now, now).catch(() => {}); // recently shown: evicted last
    return cached;
  }
  // Tried lately and failed: placeholder until the retry time.
  const miss = await stat(`${file}.miss`).catch(() => null);
  if (miss && Date.now() - miss.mtimeMs < RETRY_MISSING_MS) return null;

  const running = inflight.get(key);
  if (running) return running;
  const job = (async () => {
    const url = await sourceOf(key);
    if (!url) return null;
    await mkdir(dir(), { recursive: true });
    try {
      const small = await shrink(await fetcher(url));
      await writeFile(file, small);
      await unlink(`${file}.miss`).catch(() => {});
      void prune(file);
      return small;
    } catch {
      await writeFile(`${file}.miss`, "").catch(() => {});
      return null;
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** Keeps the image cache under its size, dropping the least recently shown first. */
async function prune(keep: string) {
  const entries = (
    await Promise.all(
      (await readdir(dir()).catch(() => [])).map(async (f) => {
        const p = path.join(dir(), f);
        const s = await stat(p).catch(() => null);
        return s?.isFile() ? { p, size: s.size, mtime: s.mtimeMs } : null;
      }),
    )
  ).filter((e): e is { p: string; size: number; mtime: number } => !!e);
  let total = entries.reduce((n, e) => n + e.size, 0);
  for (const e of entries.sort((a, b) => a.mtime - b.mtime)) {
    if (total <= maxBytes()) break;
    if (e.p === keep) continue;
    await unlink(e.p).catch(() => {});
    total -= e.size;
  }
}

export type BackfillReport = { total: number; alreadyCached: number; fetched: number; missing: number };

/**
 * Fills the cache for every song that has artwork, newest first (so if the
 * cache can't hold them all, the ones kept are the likeliest to be shown).
 * Songs that failed lately are skipped unless `retryMissing`.
 */
export async function backfillArt(
  opts: { concurrency?: number; retryMissing?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<BackfillReport> {
  const rows = await db
    .select({ key: schema.tracks.sourceKey })
    .from(schema.tracks)
    .where(isNotNull(schema.tracks.thumbnailUrl))
    .orderBy(desc(schema.tracks.createdAt));
  const report: BackfillReport = { total: rows.length, alreadyCached: 0, fetched: 0, missing: 0 };
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < rows.length) {
      const { key } = rows[next++];
      const file = fileFor(key);
      if (await stat(file).catch(() => null)) report.alreadyCached++;
      else {
        if (opts.retryMissing) await unlink(`${file}.miss`).catch(() => {});
        if (await artFor(key)) report.fetched++;
        else report.missing++;
      }
      opts.onProgress?.(++done, rows.length);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));
  return report;
}
