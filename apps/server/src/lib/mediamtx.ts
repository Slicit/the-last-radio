import { env } from "./env.js";

export type StreamStatus = {
  live: boolean;
  readySince: string | null;
  bytesReceived: number;
  tracks: string[];
};

const OFFLINE: StreamStatus = { live: false, readySince: null, bytesReceived: 0, tracks: [] };

/** Asks mediamtx whether the broadcaster is currently publishing the radio's path. */
export async function streamStatus(path: string): Promise<StreamStatus> {
  try {
    const res = await fetch(`${env.MEDIAMTX_API}/v3/paths/get/${encodeURIComponent(path)}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return OFFLINE;
    const p = await res.json();
    return {
      live: Boolean(p.ready),
      readySince: p.readyTime ?? null,
      bytesReceived: Number(p.bytesReceived ?? 0),
      tracks: Array.isArray(p.tracks) ? p.tracks : [],
    };
  } catch {
    return OFFLINE;
  }
}
