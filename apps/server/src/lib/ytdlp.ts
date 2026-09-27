import { spawn } from "node:child_process";
import { assertPublicUrl } from "./url-safety.js";

// yt-dlp needs a JS runtime for YouTube; node is always present in our image.
// The generic extractor (any web page / raw file URL) is off: only sites yt-dlp
// knows (YouTube, SoundCloud, Bandcamp, …) can be fetched.
export const YTDLP_BASE_ARGS = [
  "--no-playlist",
  "--no-warnings",
  "--js-runtimes",
  "node",
  "--use-extractors",
  "default,-generic",
];

// The link or search yt-dlp works on is always the last argument.
const YOUTUBE = /^(ytsearch\d*:|https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be|youtube-nocookie\.com)\/)/i;

/**
 * YouTube blocks many server addresses: when YOUTUBE_PROXY is set (e.g.
 * http://10.66.0.2:8888), YouTube links and searches go through it, nothing else.
 */
export function proxyArgs(args: string[], proxy = process.env.YOUTUBE_PROXY ?? ""): string[] {
  return proxy && YOUTUBE.test(args[args.length - 1] ?? "") ? ["--proxy", proxy] : [];
}

export type ProbeResult = {
  sourceKey: string;
  sourceUrl: string;
  title: string;
  artist: string | null;
  durationSec: number | null;
  thumbnailUrl: string | null;
  /** Only a 30-second sample is available (SoundCloud's previews of Go+ songs). */
  isPreview: boolean;
};

/** SoundCloud offers only "…_preview" formats for songs it won't stream in full. */
export const previewOnly = (formats: unknown) =>
  Array.isArray(formats) && formats.length > 0 && formats.every((f) => /preview/i.test(String(f?.format_id ?? "")));

export class ProbeError extends Error {}

export class AbortedError extends Error {}

export function runYtdlp(args: string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError("aborted"));
    const proc = spawn("yt-dlp", [...YTDLP_BASE_ARGS, ...proxyArgs(args), ...args], {
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
      if (/Unsupported URL|No suitable extractor/i.test(line)) {
        return reject(new ProbeError("That site isn't supported. Try a YouTube, SoundCloud or Bandcamp link, or search by name."));
      }
      reject(new ProbeError(line.replace(/^ERROR:\s*/, "").slice(0, 300) || "yt-dlp failed"));
    });
  });
}

/** Resolves a user-submitted URL into canonical track metadata without downloading it. */
export async function probe(url: string): Promise<ProbeResult> {
  try {
    await assertPublicUrl(url);
  } catch (e) {
    throw new ProbeError((e as Error).message);
  }
  // "--" so a link can never be read as an option.
  const raw = await runYtdlp(["-J", "--skip-download", "--", url], 45_000);
  const info = JSON.parse(raw);
  if (!info || typeof info !== "object") {
    throw new ProbeError("That site isn't supported. Try a YouTube, SoundCloud or Bandcamp link, or search by name.");
  }
  if (info._type === "playlist") throw new ProbeError("Playlists are not supported, push a single track");
  if (info.is_live) throw new ProbeError("Live streams can't be queued");
  return {
    sourceKey: `${info.extractor_key}:${info.id}`,
    sourceUrl: info.webpage_url ?? url,
    title: String(info.track ?? info.title ?? "Untitled").slice(0, 300),
    artist: (info.artist ?? info.uploader ?? info.channel ?? null)?.toString().slice(0, 200) ?? null,
    durationSec: typeof info.duration === "number" ? Math.round(info.duration) : null,
    thumbnailUrl: info.thumbnail ?? null,
    isPreview: previewOnly(info.formats),
  };
}
