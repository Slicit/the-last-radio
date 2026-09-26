export type Role = "admin" | "player";
export type User = { id: string; email: string; displayName: string; role: Role };

export type Track = {
  id: string;
  title: string;
  artist: string | null;
  durationSec: number | null;
  thumbnailUrl: string | null;
  sourceUrl: string;
  sourceKey: string;
};

export type SearchResult = Omit<Track, "id"> & { videoId: string; views: number | null };

export type QueueItem = {
  id: string;
  status: "queued" | "playing" | "played" | "skipped" | "removed" | "failed";
  skipReason: "admin" | "owner" | "votes" | "interrupted" | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  track: Track;
  /** Alfred, the fill-in bot, picked it (pushedBy is then null). */
  isFill: boolean;
  pushedBy: { id: string; displayName: string } | null;
};

export type Radio = {
  id: string;
  slug: string;
  name: string;
  description: string;
  isActive: boolean;
  rateLimitCount: number;
  rateLimitWindowSec: number;
  maxTrackSec: number;
  skipVotePercent: number;
  hoursEnabled: boolean;
  hoursDays: number[];
  hoursStart: string;
  hoursEnd: string;
  timezone: string;
  autofillBelowSec: number;
  hours: HoursStatus;
};

export type HoursStatus = {
  open: boolean;
  next: { inDays: number; weekday: number; time: string } | null;
  closesAt: string | null;
};

export type RadioSummary = Radio & {
  nowPlaying: QueueItem | null;
  queueLength: number;
  listeners: number;
};

export type Quota = {
  unlimited: boolean;
  limit: number;
  windowSec: number;
  used: number;
  remaining: number;
  nextSlotAt: string | null;
};

export type SkipState = {
  enabled: boolean;
  votes: number;
  needed: number;
  voted: boolean;
  canVote: boolean;
  isOwner: boolean;
};

export type RadioDetail = {
  radio: Radio;
  nowPlaying: QueueItem | null;
  skip: SkipState | null;
  queue: QueueItem[];
  quota: Quota | null;
  serverTime: string;
};

export type RadioStats = {
  topPlayers: { user: { id: string; displayName: string }; plays: number; listenedSec: number }[];
  totals: { plays: number; uniqueTracks: number; uniquePlayers: number; airtimeSec: number; downvotes: number };
};

export type SongSort = "played" | "score" | "downvoted" | "recent";

/** A song's record on one station; Alfred picks by `score`. */
export type SongRecord = {
  track: Track;
  plays: number;
  playsByPeople: number;
  playsByAlfred: number;
  airings: number;
  adders: number;
  downvotes: number;
  skips: number;
  lastPlayedAt: string | null;
  lastOutcome: string | null;
  score: number;
  alfredOk: boolean;
};

export type StreamStatus = {
  live: boolean;
  readySince: string | null;
  bytesReceived: number;
  tracks: string[];
  listeners: number;
  hlsUrl: string;
};

export type AdminUser = User & { createdAt: string; pushes: number; plays: number };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    signal,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, signal),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};
