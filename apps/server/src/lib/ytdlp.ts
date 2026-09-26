import { spawn } from "node:child_process";

// yt-dlp needs a JS runtime for YouTube; node is always present in our image.
export const YTDLP_BASE_ARGS = ["--no-playlist", "--no-warnings", "--js-runtimes", "node"];

export type ProbeResult = {
  sourceKey: string;
  sourceUrl: string;
  title: string;
  artist: string | null;
  durationSec: number | null;
  thumbnailUrl: string | null;
};

export class ProbeError extends Error {}

export class AbortedError extends Error {}

export function runYtdlp(args: string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError("aborted"));
    const proc = spawn("yt-dlp", [...YTDLP_BASE_ARGS, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    // The caller went away (e.g. the user kept typing): don't burn CPU on it.
    const onAbort = () => proc.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err += d));
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code, killSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (code === 0) return resolve(out);
      if (signal?.aborted) return reject(new AbortedError("aborted"));
      if (killSignal) return reject(new ProbeError("Timed out while reading that link"));
      const line = err.split("\n").find((l) => l.startsWith("ERROR:")) ?? err.trim();
      reject(new ProbeError(line.replace(/^ERROR:\s*/, "").slice(0, 300) || "yt-dlp failed"));
    });
  });
}

/** Resolves a user-submitted URL into canonical track metadata without downloading it. */
export async function probe(url: string): Promise<ProbeResult> {
  const raw = await runYtdlp(["-J", "--skip-download", url], 45_000);
  const info = JSON.parse(raw);
  if (info._type === "playlist") throw new ProbeError("Playlists are not supported, push a single track");
  if (info.is_live) throw new ProbeError("Live streams can't be queued");
  return {
    sourceKey: `${info.extractor_key}:${info.id}`,
    sourceUrl: info.webpage_url ?? url,
    title: String(info.track ?? info.title ?? "Untitled").slice(0, 300),
    artist: (info.artist ?? info.uploader ?? info.channel ?? null)?.toString().slice(0, 200) ?? null,
    durationSec: typeof info.duration === "number" ? Math.round(info.duration) : null,
    thumbnailUrl: info.thumbnail ?? null,
  };
}
