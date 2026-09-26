export type Role = "admin" | "player";
export type User = { id: string; email: string; displayName: string; role: Role };

export type Track = {
  id: string;
  title: string;
  artist: string | null;
  durationSec: number | null;
  thumbnailUrl: string | null;
  sourceUrl: string;
};

export type QueueItem = {
  id: string;
  status: "queued" | "playing" | "played" | "skipped" | "removed" | "failed";
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  track: Track;
  pushedBy: { id: string; displayName: string };
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

export type RadioDetail = {
  radio: Radio;
  nowPlaying: QueueItem | null;
  queue: QueueItem[];
  quota: Quota | null;
  serverTime: string;
};

export type RadioStats = {
  topTracks: { track: Omit<Track, "durationSec">; plays: number; lastPlayedAt: string }[];
  topPlayers: { user: { id: string; displayName: string }; plays: number; listenedSec: number }[];
  totals: { plays: number; uniqueTracks: number; uniquePlayers: number; airtimeSec: number };
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};
