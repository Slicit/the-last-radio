import { runYtdlp, type ProbeResult } from "./ytdlp.js";

export const SEARCH_SOURCES = ["youtube", "soundcloud"] as const;
export type SearchSource = (typeof SEARCH_SOURCES)[number];
export type SearchResult = ProbeResult & { videoId: string; views: number | null; source: SearchSource };

const RESULTS = 8;
const CACHE_TTL_MS = 10 * 60_000;
const KNOWN_TTL_MS = 60 * 60_000;
const PREFIX: Record<SearchSource, string> = { youtube: "ytsearch", soundcloud: "scsearch" };

const queryCache = new Map<string, { at: number; results: SearchResult[] }>();
// Metadata of every song we've shown in results, by source key and by page URL,
// so adding one skips the slow probe.
const known = new Map<string, { at: number; meta: ProbeResult }>();

const normalize = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

function sweep<T extends { at: number }>(m: Map<string, T>, ttl: number) {
  const cutoff = Date.now() - ttl;
  for (const [k, v] of m) if (v.at < cutoff) m.delete(k);
}

/** "Daft Punk - Topic" is YouTube's auto-generated artist channel; show just the artist. */
const cleanChannel = (c: unknown) =>
  typeof c === "string" ? c.replace(/\s+-\s+Topic$/i, "").trim() || null : null;

/** One flat search entry from yt-dlp → a result, or null if it can't be queued (live, no length). */
export function toResult(e: any, source: SearchSource): SearchResult | null {
  if (!e?.id || typeof e.duration !== "number" || e.live_status === "is_live") return null;
  const id = String(e.id);
  const common = {
    videoId: id,
    title: String(e.title ?? "Untitled").slice(0, 300),
    durationSec: Math.round(e.duration),
    views: typeof e.view_count === "number" ? e.view_count : null,
    source,
  };
  if (source === "youtube") {
    return {
      ...common,
      sourceKey: `Youtube:${id}`,
      sourceUrl: `https://www.youtube.com/watch?v=${id}`,
      artist: cleanChannel(e.channel ?? e.uploader),
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  }
  const art = (e.thumbnails as { url?: string }[] | undefined)?.at(-1)?.url ?? null;
  if (!e.webpage_url) return null;
  return {
    ...common,
    // Same key the link probe produces, so duplicates are caught either way.
    sourceKey: `Soundcloud:${id}`,
    sourceUrl: String(e.webpage_url),
    artist: typeof e.uploader === "string" ? e.uploader : null,
    // SoundCloud's "-original" artwork can be huge; its 300px variant is plenty.
    thumbnailUrl: art ? art.replace(/-original\.(\w+)$/, "-t300x300.$1") : null,
  };
}

export async function searchSongs(query: string, source: SearchSource = "youtube", signal?: AbortSignal): Promise<SearchResult[]> {
  const q = normalize(query);
  const key = `${source}:${q}`;
  const hit = queryCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results;

  const raw = await runYtdlp(["--flat-playlist", "-J", `${PREFIX[source]}${RESULTS}:${q}`], 30_000, signal);
  const entries: any[] = JSON.parse(raw)?.entries ?? [];
  const results = entries.map((e) => toResult(e, source)).filter((r): r is SearchResult => r !== null);

  sweep(queryCache, CACHE_TTL_MS);
  sweep(known, KNOWN_TTL_MS);
  queryCache.set(key, { at: Date.now(), results });
  for (const { videoId: _v, views: _n, source: _s, ...meta } of results) {
    known.set(meta.sourceKey, { at: Date.now(), meta });
    known.set(meta.sourceUrl, { at: Date.now(), meta });
  }
  return results;
}

/** Kept for callers that only ever search YouTube. */
export const searchYoutube = (query: string, signal?: AbortSignal) => searchSongs(query, "youtube", signal);

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** Metadata for a link we recently showed in search results, if any. */
export function knownFromUrl(url: string): ProbeResult | null {
  const fresh = (k: string) => {
    const e = known.get(k);
    return e && Date.now() - e.at < KNOWN_TTL_MS ? e.meta : null;
  };
  const byUrl = fresh(url);
  if (byUrl) return byUrl;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    const id = host === "youtube.com" ? u.searchParams.get("v") : host === "youtu.be" ? u.pathname.slice(1) : null;
    if (id && YT_ID.test(id)) return fresh(`Youtube:${id}`);
  } catch {
    /* not a URL */
  }
  return null;
}
