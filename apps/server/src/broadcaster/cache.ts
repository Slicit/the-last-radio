import { mkdir, readdir, stat, unlink, utimes } from "node:fs/promises";
import path from "node:path";
import { runYtdlp } from "../lib/ytdlp.js";

type CachedTrack = { id: string; sourceUrl: string };

/**
 * Downloads tracks ahead of airtime so playback never depends on the remote
 * host keeping up in real time. Files are named `<trackId>.<ext>` and evicted
 * oldest-first once the cache grows past `maxBytes`.
 */
export class AudioCache {
  private inflight = new Map<string, Promise<string>>();

  constructor(
    private dir: string,
    private maxBytes: number,
  ) {}

  async init() {
    await mkdir(this.dir, { recursive: true });
  }

  private async find(trackId: string): Promise<string | null> {
    const files = await readdir(this.dir);
    const hit = files.find(
      (f) => f.startsWith(`${trackId}.`) && !f.endsWith(".part") && !f.endsWith(".ytdl"),
    );
    return hit ? path.join(this.dir, hit) : null;
  }

  ensure(track: CachedTrack): Promise<string> {
    const running = this.inflight.get(track.id);
    if (running) return running;
    const job = (async () => {
      const existing = await this.find(track.id);
      if (existing) {
        const now = new Date();
        await utimes(existing, now, now).catch(() => {});
        return existing;
      }
      await runYtdlp(
        ["-f", "bestaudio/best", "-o", path.join(this.dir, `${track.id}.%(ext)s`), track.sourceUrl],
        10 * 60_000,
      );
      const file = await this.find(track.id);
      if (!file) throw new Error("Download finished but no audio file was produced");
      await this.prune(new Set([file]));
      return file;
    })().finally(() => this.inflight.delete(track.id));
    this.inflight.set(track.id, job);
    return job;
  }

  private async prune(keep: Set<string>) {
    const entries = await Promise.all(
      (await readdir(this.dir)).map(async (f) => {
        const p = path.join(this.dir, f);
        const s = await stat(p).catch(() => null);
        return s?.isFile() ? { p, size: s.size, mtime: s.mtimeMs } : null;
      }),
    );
    const files = entries.filter((e) => e !== null).sort((a, b) => a.mtime - b.mtime);
    let total = files.reduce((n, f) => n + f.size, 0);
    for (const f of files) {
      if (total <= this.maxBytes) break;
      if (keep.has(f.p)) continue;
      await unlink(f.p).catch(() => {});
      total -= f.size;
    }
  }
}
