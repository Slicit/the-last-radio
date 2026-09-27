// The Last Radio as an MCP server: lets someone's AI assistant see the
// stations, what's on and what's next, find and add songs, and downvote,
// acting as that person (and within their quotas). Everything goes through
// services/radio.ts, the same code the website uses.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { ilike } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { Radio } from "../db/schema.js";
import type { PublicUser } from "../lib/auth.js";
import type { Scope } from "../lib/tokens.js";
import { SEARCH_SOURCES, searchWithFallback } from "../lib/search.js";
import { songRecords, type SongSort } from "../lib/track-stats.js";
import * as svc from "../services/radio.js";
import { canAccess } from "../lib/access.js";
import { upvote } from "../lib/upvotes.js";
import { fmtDuration, itemLine, nextOpeningText, ordinal, when } from "./format.js";

type Ctx = { user: PublicUser; scopes: Scope[]; baseUrl: string };

const INSTRUCTIONS = `The Last Radio is a shared web radio: each station plays one live stream and listeners pick the music.
You act as the signed-in listener. Typical flow: list_stations → now_playing or get_queue → search_songs → add_song.
Stations are named by slug or name. People can add a limited number of songs per time window; the tools say when the next slot opens.
Downvoting only counts while the person is listening to that station in their browser.
The same features are available as a REST API described at /api/openapi.json.`;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });

/** Service errors are written for people; hand them to the AI as tool errors, not crashes. */
async function run(fn: () => Promise<string>): Promise<ToolResult> {
  try {
    return text(await fn());
  } catch (e) {
    if (e instanceof HTTPException) return { ...text(e.message), isError: true };
    console.error("mcp tool:", e);
    return { ...text("Something went wrong on the radio's side. Try again in a moment."), isError: true };
  }
}

/** Accepts a slug ("main") or a name ("Main Stage"), case-insensitively. */
async function findStation(ref: string, user: PublicUser): Promise<Radio> {
  const q = ref.trim();
  const bySlug = await db.query.radios.findFirst({ where: ilike(schema.radios.slug, q) });
  const radio = bySlug ?? (await db.query.radios.findFirst({ where: ilike(schema.radios.name, q) }));
  if (!radio || (!radio.isActive && user.role !== "admin") || !(await canAccess(radio, user))) {
    const names = (await svc.listRadios(user)).map((r) => `${r.name} (${r.slug})`).join(", ");
    throw new HTTPException(404, { message: `No station "${ref}". Stations: ${names || "none yet"}.` });
  }
  return radio;
}

const station = z.string().min(1).describe('Station slug or name, e.g. "main" or "Main Stage"');

export function buildMcpServer(ctx: Ctx): McpServer {
  const { user } = ctx;
  const server = new McpServer({ name: "the-last-radio", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  const can = (s: Scope) => ctx.scopes.includes(s);
  const link = (slug: string) => `${ctx.baseUrl}/r/${slug}`;

  // ------------------------------------------------------------ reading

  server.registerTool(
    "list_stations",
    {
      title: "List stations",
      description: "All radio stations: what's playing, listeners, queue length, and whether they're open.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      run(async () => {
        const radios = await svc.listRadios(user);
        if (!radios.length) return "There are no stations yet.";
        return radios
          .map((r) => {
            const status = r.hours.open ? "open" : `closed, ${nextOpeningText(r.hours)}`;
            const np = r.nowPlaying ? `now playing ${itemLine(r.nowPlaying)}` : "nothing playing";
            return `• ${r.name} (slug: ${r.slug}), ${status}: ${np}. ${r.listeners} listening, ${r.queueLength} queued. ${link(r.slug)}`;
          })
          .join("\n");
      }),
  );

  server.registerTool(
    "now_playing",
    {
      title: "What's playing",
      description:
        "The song on air at a station with time left, downvotes, the next few songs, and how many songs you can still add.",
      inputSchema: { station },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ station: ref }) =>
      run(async () => {
        const radio = await findStation(ref, user);
        const d = await svc.radioDetail(radio, user);
        const lines = [`${radio.name}: ${d.radio.hours.open ? "open" : `closed, ${nextOpeningText(d.radio.hours)}`}, ${d.listeners} listening.`];
        if (d.nowPlaying) {
          const left = timeLeft(d.nowPlaying);
          lines.push(`Now playing: ${itemLine(d.nowPlaying)}${left ? `, ${fmtDuration(left)} left` : ""}.`);
          lines.push(`Link: ${d.nowPlaying.track.sourceUrl}`);
          if (d.skip?.enabled) {
            lines.push(
              `Downvotes: ${d.skip.votes} of ${d.skip.needed} needed to skip${d.skip.voted ? " (you downvoted it)" : ""}.`,
            );
          }
          if (d.skip?.isOwner) lines.push("You added this song, so you can skip it (skip_my_song).");
        } else {
          lines.push("Nothing is playing right now.");
        }
        if (d.queue.length) {
          lines.push(`Up next (${d.queueTotal}):`);
          d.queue.slice(0, 5).forEach((q, i) => lines.push(`  ${i + 1}. ${itemLine(q)}`));
        } else {
          lines.push("The queue is empty.");
        }
        if (d.quota) lines.push(quotaLine(d.quota));
        return lines.join("\n");
      }),
  );

  server.registerTool(
    "get_queue",
    {
      title: "Station queue",
      description:
        "What's lined up at a station, in play order, with roughly when each song will start. 20 songs per page.",
      inputSchema: { station, page: z.number().int().min(1).default(1).describe("Page of 20 songs") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ station: ref, page }) =>
      run(async () => {
        const radio = await findStation(ref, user);
        const d = await svc.radioDetail(radio, user);
        const queue = await svc.fullQueue(radio);
        if (!queue.length) return `${radio.name}'s queue is empty.`;
        let at = timeLeft(d.nowPlaying);
        const starts = queue.map((q) => {
          const s = at;
          at += q.track.durationSec ?? 0;
          return s;
        });
        const from = (page - 1) * 20;
        const lines = queue.slice(from, from + 20).map((q, i) =>
          `${from + i + 1}. ${itemLine(q)}, starts ${when(starts[from + i])}${q.pushedBy?.id === user.id ? " (yours)" : ""}`,
        );
        if (!lines.length) return `${radio.name} has ${queue.length} songs lined up; page ${page} is past the end.`;
        const pages = Math.ceil(queue.length / 20);
        return [
          `${radio.name}, ${queue.length} songs lined up (${fmtDuration(at)} total)${pages > 1 ? `, page ${page} of ${pages}` : ""}:`,
          ...lines,
        ].join("\n");
      }),
  );

  server.registerTool(
    "song_stats",
    {
      title: "Station song stats",
      description:
        "Songs a station has played with plays, people who added them, downvotes and skips. Sort by most played, crowd favourites (score), most downvoted or recently played.",
      inputSchema: {
        station,
        sort: z.enum(["played", "score", "downvoted", "recent"]).default("played").describe("How to rank the songs"),
        limit: z.number().int().min(1).max(50).default(10),
        page: z.number().int().min(1).default(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ station: ref, sort, limit, page }) =>
      run(async () => {
        const radio = await findStation(ref, user);
        const songs = await songRecords(radio.id, sort as SongSort, limit, (page - 1) * limit);
        if (!songs.length) return `${radio.name} hasn't played anything yet.`;
        return songs
          .map(
            (s, i) =>
              `${(page - 1) * limit + i + 1}. "${s.track.title}": ${s.plays} plays, added by ${s.adders}, ${s.downvotes} downvotes, ${s.skips} skips (score ${s.score}${s.alfredOk ? "" : ", Alfred won't replay it"}). song_id: ${s.track.id}`,
          )
          .join("\n");
      }),
  );

  server.registerTool(
    "search_songs",
    {
      title: "Search songs",
      description:
        "Search YouTube (default) or SoundCloud for songs by artist and/or title. Returns candidates with their url; pass a url to add_song. Give a station to see which ones can be added there.",
      inputSchema: {
        query: z.string().min(2).max(120).describe('Artist and/or title, e.g. "Daft Punk Around the World"'),
        source: z.enum(SEARCH_SOURCES).default("youtube").describe("Where to search"),
        station: station.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ query, source, station: ref }) =>
      run(async () => {
        const { results, fallbackFrom } = await searchWithFallback(query, source);
        const note = fallbackFrom ? "YouTube isn't reachable right now, so these are SoundCloud results.\n" : "";
        if (!results.length) return `${note}Nothing found for "${query}". Try the artist and the song title.`;
        const detail = ref ? await svc.radioDetail(await findStation(ref, user), user) : null;
        return note + results
          .map((r, i) => {
            const why = detail ? blockedReason(r, detail) : null;
            const sample = r.isPreview ? " [SAMPLE: only 30 seconds play]" : "";
            return `${i + 1}. ${r.title} (${r.artist ?? "unknown"}, ${fmtDuration(r.durationSec ?? 0)})${sample}${why ? ` [can't add: ${why}]` : ""}\n   url: ${r.sourceUrl}`;
          })
          .join("\n");
      }),
  );

  // ------------------------------------------------------------ acting as the listener

  if (!can("radio:write")) return server;

  server.registerTool(
    "add_song",
    {
      title: "Add a song",
      description:
        "Add a song to a station's queue as the signed-in listener. Give exactly one of: url (from search_songs or any YouTube/SoundCloud/Bandcamp/Mixcloud link), song_id (from song_stats, to replay a song), or query (adds the best search match, from `source`). Counts toward the listener's quota.",
      inputSchema: {
        station,
        url: z.string().url().optional(),
        song_id: z.string().uuid().optional(),
        query: z.string().min(2).max(120).optional(),
        source: z.enum(SEARCH_SOURCES).default("youtube").describe("Where query searches"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ station: ref, url, song_id, query, source }) =>
      run(async () => {
        if ([url, song_id, query].filter(Boolean).length !== 1) {
          throw new HTTPException(400, { message: "Give exactly one of url, song_id or query." });
        }
        const radio = await findStation(ref, user);
        let target: svc.AddTarget;
        if (url) target = { url };
        else if (song_id) target = { trackId: song_id };
        else {
          // Take the best match that fits the station; if that song is already on air or
          // queued, say so rather than quietly adding another upload of it.
          const detail = await svc.radioDetail(radio, user);
          const fits = (await searchWithFallback(query!, source)).results.filter((r) => (r.durationSec ?? 0) <= radio.maxTrackSec);
          const pick = fits[0];
          if (!pick) throw new HTTPException(404, { message: `No match for "${query}" fits this station. Try search_songs.` });
          const why = blockedReason(pick, detail);
          if (why) throw new HTTPException(409, { message: `"${pick.title}" is ${why}.` });
          target = { url: pick.sourceUrl };
        }
        const added = await svc.addSong(radio, user, target);
        const d = await svc.radioDetail(radio, user);
        const queue = await svc.fullQueue(radio);
        const idx = queue.findIndex((q) => q.id === added.id);
        let at = timeLeft(d.nowPlaying);
        for (const q of queue.slice(0, Math.max(0, idx))) at += q.track.durationSec ?? 0;
        const closed = d.radio.hours.open ? "" : ` The station is closed; it will play after it opens ${nextOpeningText(d.radio.hours)}.`;
        return `Added "${added.track.title}" to ${radio.name}: ${ordinal(added.position)} in line, starts ${when(at)}.${closed}\n${quotaLine(added.quota)}`;
      }),
  );

  server.registerTool(
    "downvote",
    {
      title: "Downvote the song on air",
      description:
        "Vote to skip the song playing at a station. Enough downvotes from people listening skip it. Only counts while the listener is tuned in to that station.",
      inputSchema: { station },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ station: ref }) =>
      run(async () => {
        const radio = await findStation(ref, user);
        const { skipped } = await svc.downvote(radio, user);
        if (skipped) return `Downvoted, and that was enough: the song was skipped on ${radio.name}.`;
        const d = await svc.radioDetail(radio, user);
        return `Downvoted "${d.nowPlaying?.track.title}". ${d.skip?.votes ?? 1} of ${d.skip?.needed ?? "?"} downvotes needed to skip.`;
      }),
  );

  server.registerTool(
    "upvote",
    {
      title: "Upvote a song",
      description:
        "Ask to hear a song more: Alfred (the auto-DJ) picks upvoted songs more often. Defaults to the song on air; or give a song_id from song_stats. 3 upvotes a day.",
      inputSchema: { station, song_id: z.string().uuid().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ station: ref, song_id }) =>
      run(async () => {
        const radio = await findStation(ref, user);
        let trackId = song_id;
        let title = "that song";
        if (!trackId) {
          const d = await svc.radioDetail(radio, user);
          if (!d.nowPlaying) throw new HTTPException(409, { message: "Nothing is playing right now; give a song_id." });
          trackId = d.nowPlaying.track.id;
          title = `"${d.nowPlaying.track.title}"`;
        }
        const r = await upvote(radio, user, trackId);
        const left = r.allowance.remaining;
        return `${r.already ? "Already upvoted" : "Upvoted"} ${title} on ${radio.name}. ${left} upvote${left === 1 ? "" : "s"} left today.`;
      }),
  );

  server.registerTool(
    "undo_downvote",
    {
      title: "Take back a downvote",
      description: "Withdraw your downvote on the song playing at a station.",
      inputSchema: { station },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ station: ref }) =>
      run(async () => {
        const radio = await findStation(ref, user);
        await svc.undoDownvote(radio, user);
        return `Your downvote on ${radio.name} is withdrawn.`;
      }),
  );

  server.registerTool(
    "skip_my_song",
    {
      title: "Skip my song",
      description: "Skip the song on air, if the listener is the one who added it.",
      inputSchema: { station },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ station: ref }) =>
      run(async () => {
        const radio = await findStation(ref, user);
        return (await svc.skipCurrent(radio, user)) ? `Skipped on ${radio.name}.` : "Nothing is playing right now.";
      }),
  );

  return server;
}

/** Seconds left on the song on air (0 when unknown). */
function timeLeft(item: { startedAt: Date | string | null; track: { durationSec: number | null } } | null): number {
  if (!item?.startedAt || !item.track.durationSec) return 0;
  return Math.max(0, item.track.durationSec - (Date.now() - new Date(item.startedAt).getTime()) / 1000);
}

function quotaLine(q: svc.Quota): string {
  if (q.unlimited) return "You're an admin: no limit on adding songs.";
  if (q.remaining > 0) return `You can add ${q.remaining} more song${q.remaining === 1 ? "" : "s"} right now.`;
  const wait = q.nextSlotAt ? Math.max(0, (Date.parse(q.nextSlotAt) - Date.now()) / 1000) : 0;
  return `You've used your ${q.limit} songs for now; you can add another in ${fmtDuration(wait)}.`;
}

function blockedReason(
  r: { sourceKey: string; durationSec: number | null },
  d: Awaited<ReturnType<typeof svc.radioDetail>>,
): string | null {
  if (d.nowPlaying?.track.sourceKey === r.sourceKey) return "on air now";
  if (d.queuedKeys.includes(r.sourceKey)) return "already in line";
  if ((r.durationSec ?? 0) > d.radio.maxTrackSec) return `over ${Math.round(d.radio.maxTrackSec / 60)} min`;
  return null;
}
