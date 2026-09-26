import { runYtdlp, type ProbeResult } from "./ytdlp.js";

export type SearchResult = ProbeResult & { videoId: string; views: number | null };

const RESULTS = 8;
const CACHE_TTL_MS = 10 * 60_000;
const KNOWN_TTL_MS = 60 * 60_000;

const queryCache = new Map<string, { at: number; results: SearchResult[] }>();
// Metadata of every video we've shown in results, so adding one skips the slow probe.
const known = new Map<string, { at: number; meta: ProbeResult }>();

const normalize = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

function sweep<T extends { at: number }>(m: Map<string, T>, ttl: number) {
  const cutoff = Date.now() - ttl;
  for (const [k, v] of m) if (v.at < cutoff) m.delete(k);
}

/** "Daft Punk - Topic" is YouTube's auto-generated artist channel; show just the artist. */
const cleanChannel = (c: unknown) =>
  typeof c === "string" ? c.replace(/\s+-\s+Topic$/i, "").trim() || null : null;

export async function searchYoutube(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const key = normalize(query);
  const hit = queryCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results;

  const raw = await runYtdlp(["--flat-playlist", "-J", `ytsearch${RESULTS}:${key}`], 30_000, signal);
  const entries: any[] = JSON.parse(raw).entries ?? [];
  const results: SearchResult[] = entries
    // No duration means a live stream or a premiere: nothing we can queue.
    .filter((e) => e?.id && typeof e.duration === "number" && e.live_status !== "is_live")
    .map((e) => ({
      videoId: e.id,
      sourceKey: `Youtube:${e.id}`,
      sourceUrl: `https://www.youtube.com/watch?v=${e.id}`,
      title: String(e.title ?? "Untitled").slice(0, 300),
      artist: cleanChannel(e.channel ?? e.uploader),
      durationSec: Math.round(e.duration),
      thumbnailUrl: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
      views: typeof e.view_count === "number" ? e.view_count : null,
    }));

  sweep(queryCache, CACHE_TTL_MS);
  sweep(known, KNOWN_TTL_MS);
  queryCache.set(key, { at: Date.now(), results });
  for (const { videoId: _v, views: _n, ...meta } of results) known.set(meta.sourceKey, { at: Date.now(), meta });
  return results;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** Returns metadata for a YouTube URL we recently showed in search results, if any. */
export function knownFromUrl(url: string): ProbeResult | null {
  let id: string | null = null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    if (host === "youtube.com") id = u.searchParams.get("v");
    else if (host === "youtu.be") id = u.pathname.slice(1);
  } catch {
    return null;
  }
  if (!id || !YT_ID.test(id)) return null;
  const k = known.get(`Youtube:${id}`);
  return k && Date.now() - k.at < KNOWN_TTL_MS ? k.meta : null;
}
