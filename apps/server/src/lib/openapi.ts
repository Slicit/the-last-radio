import { z } from "zod";
import { SCOPES } from "./scopes.js";
import { POLICY_VERSION } from "./legal.js";
import { registerBody, loginBody } from "../routes/auth.js";
import { createRadioBody, updateRadioBody, pushBody } from "../routes/radios.js";
import { postBody as feedbackBody } from "../routes/feedback.js";
import { registerBody as oauthRegisterBody, keyBody } from "../routes/oauth.js";
import { stationFile } from "./station-transfer.js";
import { RANGES } from "./listener-stats.js";
import { settingsBody } from "../routes/settings.js";

/**
 * The REST API as OpenAPI 3.1, served at /api/openapi.json. Request bodies
 * come straight from the Zod validators the routes use; a test fails when a
 * route is missing here (test/integration/openapi.test.ts).
 */

type Json = Record<string, unknown>;
const schema = (s: z.ZodType) => z.toJSONSchema(s, { io: "input", unrepresentable: "any" }) as Json;
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const obj = (properties: Json, required: string[] = Object.keys(properties)): Json => ({ type: "object", properties, required });
const str = { type: "string" };
const int = { type: "integer" };
const bool = { type: "boolean" };
const nullable = (t: Json) => ({ anyOf: [t, { type: "null" }] });
const time = { type: "string", format: "date-time" };

const Track = obj({ id: str, title: str, artist: nullable(str), durationSec: nullable(int), thumbnailUrl: nullable(str), sourceUrl: str, sourceKey: str, unavailable: bool, isPreview: { ...bool, description: "Only a 30-second sample can be played (SoundCloud previews)" } }, ["id", "title", "sourceUrl", "sourceKey"]);
const QueueItem = obj(
  {
    id: str,
    status: { enum: ["queued", "playing", "played", "skipped", "removed", "failed"] },
    skipReason: nullable({ enum: ["admin", "owner", "votes", "interrupted"] }),
    createdAt: time,
    startedAt: nullable(time),
    endedAt: nullable(time),
    isFill: { ...bool, description: "Queued by Alfred, the fill-in DJ (then pushedBy is null)" },
    track: ref("Track"),
    pushedBy: nullable(obj({ id: str, displayName: str })),
  },
  ["id", "status", "track", "isFill"],
);
const Hours = obj({ open: bool, next: nullable(obj({ inDays: int, weekday: int, time: str })), closesAt: nullable(str) });
const Radio = obj(
  {
    id: str, slug: str, name: str, description: str, isActive: bool, isPrivate: bool,
    rateLimitCount: int, rateLimitWindowSec: int, maxTrackSec: int, skipVotePercent: int,
    hoursEnabled: bool, hoursDays: { type: "array", items: int }, hoursStart: str, hoursEnd: str, timezone: str,
    autofillBelowSec: int, hours: ref("Hours"),
  },
  ["id", "slug", "name"],
);
const Quota = obj({ unlimited: bool, limit: int, windowSec: int, used: int, remaining: int, nextSlotAt: nullable(time) });
const SongRecord = obj({
  track: ref("Track"), plays: int, playsByPeople: int, playsByAlfred: int, airings: int, adders: int, downvotes: int, upvotes: int, skips: int,
  lastPlayedAt: nullable(time), lastOutcome: nullable(str), score: { type: "number" }, alfredOk: bool, unavailable: bool,
});
const User = obj({ id: str, email: str, displayName: str, role: { enum: ["admin", "player"] }, theme: { enum: ["night", "light", "vintage"] }, avatarUrl: nullable(str), privacyAckRequired: bool, emailVerified: bool });
const Error = obj({ error: { ...str, description: "What went wrong, written for people" } });
const page = (item: Json) => obj({ items: { type: "array", items: item }, total: int, page: int, pageSize: int });

// ----------------------------------------------------------------- operations

type Auth = "public" | "user" | "read" | "write" | "session" | "admin";
const AUTH_TEXT: Record<Auth, string> = {
  public: "No sign-in needed.",
  user: "Any signed-in caller (session, API key or OAuth token).",
  read: "Anyone; with a token it needs `radio:read`. Private stations need access.",
  write: "Signed in; tokens need `radio:write`. Acts as the caller, within their limits.",
  session: "Website session only (not API keys or OAuth tokens).",
  admin: "Admins, website session only.",
};
const SECURITY: Record<Auth, Json[] | undefined> = {
  public: [],
  user: [{ session: [] }, { bearer: [] }],
  read: [{}, { session: [] }, { bearer: ["radio:read"] }],
  write: [{ session: [] }, { bearer: ["radio:write"] }],
  session: [{ session: [] }],
  admin: [{ session: [] }],
};

type Op = {
  summary: string;
  tag: string;
  auth: Auth;
  description?: string;
  query?: Record<string, Json & { description?: string; required?: boolean }>;
  body?: Json;
  bodyType?: string;
  ok?: Json;
  okStatus?: number;
  okType?: string;
};

const paging = {
  page: { ...int, minimum: 1, default: 1, description: "Page number" },
  pageSize: { ...int, minimum: 1, maximum: 100, default: 20, description: "Items per page (max 100)" },
};

const ops: Record<string, Op> = {
  "GET /api/health": { summary: "Liveness check", tag: "Meta", auth: "public", ok: obj({ ok: bool }) },
  "GET /api/legal": { summary: "Privacy notice version and data controller", tag: "Meta", auth: "public", ok: obj({ policyVersion: str, controller: nullable(str), contact: nullable(str) }) },
  "GET /api/openapi.json": { summary: "This document", tag: "Meta", auth: "public", ok: { type: "object" } },

  "POST /api/auth/register": { summary: "Create an account (the first one becomes admin)", tag: "Accounts", auth: "public", body: schema(registerBody), ok: obj({ user: ref("User") }), okStatus: 201, description: "Sets the session cookie. Sends an email confirmation link when mail is configured." },
  "POST /api/auth/login": { summary: "Sign in", tag: "Accounts", auth: "public", body: schema(loginBody), ok: obj({ user: ref("User") }), description: "Sets the session cookie. 5 wrong passwords lock the account for 15 minutes." },
  "POST /api/auth/logout": { summary: "Sign out", tag: "Accounts", auth: "public", ok: obj({ ok: bool }) },
  "GET /api/auth/me": { summary: "Who am I", tag: "Accounts", auth: "public", ok: obj({ user: nullable(ref("User")) }) },
  "POST /api/auth/verify-email": { summary: "Confirm an email address with the link's token", tag: "Accounts", auth: "public", body: obj({ token: str }), ok: obj({ ok: bool }) },

  "GET /api/radios": { summary: "List the stations you can see", tag: "Stations", auth: "read", ok: obj({ radios: { type: "array", items: { allOf: [ref("Radio"), obj({ nowPlaying: nullable(ref("QueueItem")), queueLength: int, listeners: int })] } } }) },
  "POST /api/radios": { summary: "Create a station", tag: "Stations", auth: "admin", body: schema(createRadioBody), ok: obj({ radio: ref("Radio") }), okStatus: 201 },
  "GET /api/radios/{slug}": {
    summary: "A station: now playing, first page of the queue, your quota",
    tag: "Stations",
    auth: "read",
    ok: obj({
      radio: ref("Radio"), nowPlaying: nullable(ref("QueueItem")),
      skip: nullable(obj({ enabled: bool, votes: int, needed: int, voted: bool, canVote: bool, isOwner: bool })),
      queue: { type: "array", items: ref("QueueItem"), description: "First 20; page with /queue" },
      queueTotal: int, queueDurationSec: int, queuedKeys: { type: "array", items: str }, quota: nullable(ref("Quota")), listeners: int, serverTime: time,
    }),
  },
  "GET /api/radios/{slug}/export": { summary: "Export a station: settings, access, songs, history and votes, as one file", tag: "Stations", auth: "admin", ok: schema(stationFile), description: "Downloaded as <slug>-<date>.lastradio.json. It names the people in the history, with their emails, so they can be matched on import: keep it safe." },
  "POST /api/radios/import": { summary: "Recreate a station from an export file", tag: "Stations", auth: "admin", query: { slug: { ...str, description: "Slug for the new station (default: the file's)" }, name: { ...str, description: "Name for the new station (default: the file's)" } }, body: schema(stationFile), okStatus: 201, ok: obj({ radio: ref("Radio"), summary: obj({ songs: int, newSongs: int, plays: int, queued: int, people: obj({ matched: int, placeholders: int }), downvotes: int, upvotes: int }) }), description: "Always creates a new station (409 if the slug is taken). Songs already known here are reused; people are matched to accounts by email, others keep their name on a placeholder that can't sign in. Up to 50 MB." },
  "PATCH /api/radios/{slug}": { summary: "Edit a station", tag: "Stations", auth: "admin", body: schema(updateRadioBody), ok: obj({ radio: ref("Radio") }) },
  "GET /api/radios/{slug}/queue": { summary: "What's lined up, in play order", tag: "Stations", auth: "read", query: paging, ok: { allOf: [page(ref("QueueItem")), obj({ totalDurationSec: int })] } },
  "GET /api/radios/{slug}/history": { summary: "What has aired, newest first", tag: "Stations", auth: "read", query: paging, ok: page(ref("QueueItem")) },
  "GET /api/radios/{slug}/songs": {
    summary: "Every song the station aired, with its record",
    tag: "Stations",
    auth: "read",
    query: { ...paging, sort: { enum: ["played", "score", "downvoted", "recent"], default: "played", description: "score = what Alfred ranks by" } },
    ok: page(ref("SongRecord")),
  },
  "GET /api/radios/{slug}/stats": { summary: "Top players and totals", tag: "Stations", auth: "read", ok: obj({ topPlayers: { type: "array", items: obj({ user: obj({ id: str, displayName: str }), plays: int, listenedSec: int }) }, totals: obj({ plays: int, uniqueTracks: int, uniquePlayers: int, airtimeSec: int, downvotes: int }) }) },
  "GET /api/radios/{slug}/stream": { summary: "Is the stream live; where to play it (HLS)", tag: "Stations", auth: "read", ok: obj({ live: bool, readySince: nullable(time), listeners: int, hlsUrl: str }) },
  "POST /api/radios/{slug}/listen": { summary: "Listener heartbeat (every ~20 s while playing)", tag: "Stations", auth: "public", body: obj({ listenerId: { ...str, minLength: 8, maxLength: 64 } }), ok: obj({ listeners: int }) },

  "POST /api/radios/{slug}/queue": { summary: "Add a song (by link or known song id)", tag: "Songs", auth: "write", body: schema(pushBody), ok: obj({ id: str, track: ref("Track"), position: int, quota: ref("Quota") }), okStatus: 201, description: "429 when the per-station limit is reached; 409 if already in line; 410 if the song is no longer available." },
  "DELETE /api/radios/{slug}/queue/{id}": { summary: "Remove a queued song (yours; admins: any)", tag: "Songs", auth: "write", ok: obj({ ok: bool }) },
  "POST /api/radios/{slug}/skip": { summary: "Skip the song on air (yours; admins: any)", tag: "Songs", auth: "write", ok: obj({ skipped: bool }) },
  "POST /api/radios/{slug}/votes": { summary: "Downvote (vote to skip) the song on air", tag: "Songs", auth: "write", body: obj({ itemId: str }), ok: obj({ skipped: bool }), description: "Only counts while you're listening to the station." },
  "DELETE /api/radios/{slug}/votes/{itemId}": { summary: "Take back your downvote", tag: "Songs", auth: "write", ok: obj({ ok: bool }) },
  "POST /api/radios/{slug}/upvotes": { summary: "Upvote a song (3 a day): Alfred plays it more", tag: "Songs", auth: "write", body: obj({ trackId: str }), ok: obj({ already: bool, allowance: obj({ limit: int, remaining: int, nextAt: nullable(time) }) }) },
  "DELETE /api/radios/{slug}/upvotes/{trackId}": { summary: "Take back an upvote", tag: "Songs", auth: "write", ok: obj({ allowance: { type: "object" } }) },
  "GET /api/search": {
    summary: "Search YouTube or SoundCloud",
    tag: "Songs",
    auth: "user",
    query: { q: { ...str, minLength: 2, maxLength: 120, required: true }, source: { enum: ["youtube", "soundcloud"], default: "youtube" } },
    ok: obj({ results: { type: "array", items: { allOf: [ref("Track"), obj({ videoId: str, views: nullable(int), source: str })] } }, source: { enum: ["youtube", "soundcloud"], description: "Where the results come from" }, fallbackFrom: { enum: ["youtube"], description: "Set when YouTube couldn't be reached and SoundCloud answered instead" } }, ["results", "source"]),
    description: "Picking a result and posting its sourceUrl to /queue adds it instantly. When YouTube can't be reached, a YouTube search answers with SoundCloud results (fallbackFrom: \"youtube\").",
  },

  "GET /api/radios/{slug}/access": { summary: "Who may hear a private station", tag: "Private stations", auth: "admin", ok: obj({ isPrivate: bool, members: { type: "array", items: obj({ id: str, displayName: str, email: str, addedAt: time }) }, domains: { type: "array", items: str }, matches: { type: "array", items: obj({ domain: str, people: { type: "array", items: obj({ id: str, displayName: str, email: str, verified: bool }) } }) }, mailConfigured: bool }) },
  "POST /api/radios/{slug}/members": { summary: "Add someone by email", tag: "Private stations", auth: "admin", body: obj({ email: { ...str, format: "email" } }), okStatus: 201, ok: obj({ ok: bool }) },
  "DELETE /api/radios/{slug}/members/{userId}": { summary: "Remove someone", tag: "Private stations", auth: "admin", ok: obj({ ok: bool }) },
  "POST /api/radios/{slug}/domains": { summary: "Allow a verified email domain", tag: "Private stations", auth: "admin", body: obj({ domain: str }), okStatus: 201, ok: obj({ ok: bool, domain: str }) },
  "DELETE /api/radios/{slug}/domains/{domain}": { summary: "Remove a domain", tag: "Private stations", auth: "admin", ok: obj({ ok: bool }) },

  "PATCH /api/me": { summary: "Change your display name or theme", tag: "Profile", auth: "session", body: obj({ displayName: str, theme: { enum: ["night", "light", "vintage"] } }, []), ok: obj({ user: ref("User") }) },
  "PUT /api/me/avatar": { summary: "Upload a profile photo (≤ 5 MB; re-encoded to 256×256 WebP)", tag: "Profile", auth: "session", body: obj({ file: { type: "string", format: "binary" } }), bodyType: "multipart/form-data", ok: obj({ user: ref("User") }) },
  "DELETE /api/me/avatar": { summary: "Remove your photo", tag: "Profile", auth: "session", ok: obj({ user: ref("User") }) },
  "GET /api/avatars/{userId}": { summary: "Someone's profile photo", tag: "Profile", auth: "public", ok: { type: "string", format: "binary" }, okType: "image/webp" },
  "POST /api/me/privacy-ack": { summary: "Acknowledge the current privacy notice", tag: "Profile", auth: "session", body: obj({ version: { ...str, example: POLICY_VERSION } }), ok: obj({ user: ref("User") }) },
  "POST /api/me/verify-email": { summary: "Send a new email confirmation link", tag: "Profile", auth: "session", ok: obj({ ok: bool }) },
  "GET /api/me/export": { summary: "Download all your data (GDPR access and portability)", tag: "Profile", auth: "session", ok: { type: "object" } },
  "DELETE /api/me": { summary: "Delete your account (anonymised in station history)", tag: "Profile", auth: "session", body: obj({ password: str }), ok: obj({ ok: bool }) },

  "POST /api/feedback": { summary: "Send feedback (3 a day)", tag: "Feedback", auth: "user", body: schema(feedbackBody), okStatus: 201, ok: obj({ id: str, allowance: obj({ limit: int, remaining: int, nextAt: nullable(time) }) }) },
  "GET /api/feedback/mine": { summary: "What you've sent and its status", tag: "Feedback", auth: "user", ok: obj({ items: { type: "array", items: { type: "object" } }, allowance: { type: "object" } }) },
  "GET /api/admin/feedback": { summary: "Feedback inbox", tag: "Feedback", auth: "admin", query: { ...paging, view: { enum: ["inbox", "archived"], default: "inbox" }, sort: { enum: ["new", "top"], default: "new" } }, ok: { allOf: [page({ type: "object" }), obj({ unread: int })] } },
  "PATCH /api/admin/feedback/{id}": { summary: "Mark read / archive", tag: "Feedback", auth: "admin", body: obj({ read: bool, archived: bool }, []), ok: obj({ ok: bool }) },
  "POST /api/admin/feedback/{id}/vote": { summary: "Vote on its priority", tag: "Feedback", auth: "admin", body: obj({ value: { enum: [1, -1, 0] } }), ok: obj({ score: int, myVote: int }) },

  "GET /api/admin/listeners": { summary: "Listeners over time: all stations and each, average and peak per bucket", tag: "Admin", auth: "admin", query: { range: { enum: Object.keys(RANGES), default: "7d", description: "24h (5-min buckets), 7d (30 min), 30d (2 h) or 90d (6 h)" } }, ok: obj({ range: str, from: time, to: time, bucketSec: int, all: obj({ points: { type: "array", items: obj({ t: time, avg: { type: "number" }, peak: int }) }, peak: int, peakAt: nullable(time), avg: { type: "number" } }), stations: { type: "array", items: { allOf: [obj({ station: obj({ id: str, slug: str, name: str, isPrivate: bool }) }), obj({ points: { type: "array", items: obj({ t: time, avg: { type: "number" }, peak: int }) }, peak: int, peakAt: nullable(time), avg: { type: "number" } })] } } }), description: "Counted every 5 minutes and kept for good; charts show up to the last 3 months." },
  "GET /api/settings": { summary: "Radio-wide settings anyone can read", tag: "Admin", auth: "public", ok: obj({ defaultTheme: { enum: ["night", "light", "vintage"], description: "What guests see and new accounts start with" }, emailEnabled: { ...bool, description: "Whether the radio can send email (confirmation links)" } }) },
  "PATCH /api/admin/settings": { summary: "Change radio-wide settings (the default theme)", tag: "Admin", auth: "admin", body: schema(settingsBody), ok: obj({ defaultTheme: { enum: ["night", "light", "vintage"] } }) },
  "GET /api/users": { summary: "Everyone, with activity", tag: "Admin", auth: "admin", query: { ...paging, q: { ...str, maxLength: 100, description: "Name or email contains" }, filter: { enum: ["all", "admins", "unconfirmed", "former"], default: "all", description: "former = deleted accounts and imported placeholders" } }, ok: page(ref("User")) },
  "PATCH /api/users/{id}": { summary: "Change someone's role, or vouch for their email", tag: "Admin", auth: "admin", body: obj({ role: { enum: ["admin", "player"] }, emailVerified: bool }, []), ok: { type: "object" } },

  "GET /api/access": { summary: "Your API keys and connected apps", tag: "API access", auth: "session", ok: obj({ keys: { type: "array", items: { type: "object" } }, apps: { type: "array", items: { type: "object" } } }) },
  "POST /api/access/keys": { summary: "Create an API key (shown once)", tag: "API access", auth: "session", body: schema(keyBody), okStatus: 201, ok: obj({ token: str, key: { type: "object" } }) },
  "DELETE /api/access/keys/{id}": { summary: "Revoke a key", tag: "API access", auth: "session", ok: obj({ ok: bool }) },
  "DELETE /api/access/apps/{clientId}": { summary: "Disconnect an app (revokes its tokens)", tag: "API access", auth: "session", ok: obj({ ok: bool }) },

  "POST /api/oauth/register": { summary: "Dynamic client registration (RFC 7591)", tag: "OAuth", auth: "public", body: schema(oauthRegisterBody), okStatus: 201, ok: { type: "object" } },
  "GET /api/oauth/authorize": { summary: "Consent page data", tag: "OAuth", auth: "session", ok: { type: "object" } },
  "POST /api/oauth/authorize": { summary: "Approve or deny (the consent page)", tag: "OAuth", auth: "session", ok: obj({ redirectTo: str }) },
  "POST /api/oauth/token": { summary: "Token endpoint: authorization_code (PKCE S256) or refresh_token", tag: "OAuth", auth: "public", bodyType: "application/x-www-form-urlencoded", body: obj({ grant_type: { enum: ["authorization_code", "refresh_token"] }, client_id: str, code: str, code_verifier: str, redirect_uri: str, refresh_token: str }, ["grant_type", "client_id"]), ok: obj({ access_token: str, token_type: str, expires_in: int, refresh_token: str, scope: str }) },
  "POST /api/oauth/revoke": { summary: "Revoke a token (RFC 7009)", tag: "OAuth", auth: "public", bodyType: "application/x-www-form-urlencoded", body: obj({ token: str }) },
};

function toPath(key: string) {
  const [method, path] = key.split(" ");
  return { method: method.toLowerCase(), path };
}

export function openapiDocument(serverUrl: string) {
  const paths: Record<string, Record<string, Json>> = {};
  for (const [key, op] of Object.entries(ops)) {
    const { method, path } = toPath(key);
    const pathParams = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: str }));
    const queryParams = Object.entries(op.query ?? {}).map(([name, { required, description, ...s }]) => ({ name, in: "query", required: !!required, description, schema: s }));
    paths[path] ??= {};
    paths[path][method] = {
      summary: op.summary,
      description: [op.description, AUTH_TEXT[op.auth]].filter(Boolean).join("\n\n"),
      tags: [op.tag],
      security: SECURITY[op.auth],
      parameters: [...pathParams, ...queryParams],
      ...(op.body ? { requestBody: { required: true, content: { [op.bodyType ?? "application/json"]: { schema: op.body } } } } : {}),
      responses: {
        [String(op.okStatus ?? 200)]: { description: "OK", content: { [op.okType ?? "application/json"]: { schema: op.ok ?? { type: "object" } } } },
        "4XX": { description: "A problem with the request, explained", content: { "application/json": { schema: ref("Error") } } },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "The Last Radio API",
      version: "1.0.0",
      description:
        "A collaborative web radio. Listen to stations, see what's playing, add songs and downvote, as yourself.\n\n" +
        "Authenticate with an **API key** (create one under *Connect your AI*) or an **OAuth 2.1** access token, sent as `Authorization: Bearer …`. " +
        "AI assistants can also use the MCP server at `/mcp` (Streamable HTTP).\n\n" +
        "Lists are paged: `page` and `pageSize` (default 20, max 100). Errors are `{ \"error\": \"…\" }`, written to be shown to people. " +
        "Rate limits answer 429 with `Retry-After`.",
    },
    servers: [{ url: serverUrl }],
    tags: ["Stations", "Songs", "Accounts", "Profile", "Private stations", "Feedback", "API access", "OAuth", "Admin", "Meta"].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: `API key (lr_key_…) or OAuth access token (lr_at_…). Scopes: ${Object.entries(SCOPES).map(([k, v]) => `${k} (${v})`).join("; ")}.` },
        session: { type: "apiKey", in: "cookie", name: "lr_session", description: "The website's session cookie." },
        oauth: {
          type: "oauth2",
          flows: { authorizationCode: { authorizationUrl: `${serverUrl}/oauth/authorize`, tokenUrl: `${serverUrl}/api/oauth/token`, scopes: SCOPES } },
        },
      },
      schemas: { Track, QueueItem, Radio, Hours, Quota, SongRecord, User, Error },
    },
  };
}

/** Operation keys ("GET /api/radios/{slug}"), for the completeness test. */
export const documentedRoutes = () => Object.keys(ops);
