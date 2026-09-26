import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { env } from "../lib/env.js";
import type { AudioCache } from "./cache.js";

const { queueItems, tracks } = schema;

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BYTES_PER_SEC = SAMPLE_RATE * CHANNELS * 2; // s16le
const FRAME = CHANNELS * 2;
const TICK_MS = 40;
const HIGH_WATER = BYTES_PER_SEC * 10; // pause the decoder above this
const LOW_WATER = BYTES_PER_SEC * 4; // resume it below this
const PREFETCH = 2;

type Outcome = "played" | "skipped" | "failed";

const alignDown = (n: number) => n - (n % FRAME);

/**
 * One radio on air. A single long-lived ffmpeg encoder publishes AAC over
 * RTSP to mediamtx; this class feeds it raw PCM at wall-clock rate, taking
 * audio from the current track's decoder and padding with silence whenever
 * there is none. Listeners therefore see one uninterrupted stream no matter
 * how the playlist changes.
 */
export class Channel {
  private stopped = false;
  private encoder: ChildProcess | null = null;
  private clockStart = 0;
  private written = 0;
  private ticker: NodeJS.Timeout | null = null;
  private prefetcher: NodeJS.Timeout | null = null;

  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private decoder: ChildProcess | null = null;
  private decoderDone = true;
  private onDrained: (() => void) | null = null;

  constructor(
    readonly radio: { id: string; slug: string },
    private cache: AudioCache,
  ) {}

  start() {
    this.startEncoder();
    this.ticker = setInterval(() => this.tick(), TICK_MS);
    // Tracks pushed mid-song are fetched now, not when their turn comes.
    this.prefetcher = setInterval(() => void this.prefetch(), 10_000);
    void this.loop();
  }

  stop() {
    this.stopped = true;
    if (this.ticker) clearInterval(this.ticker);
    if (this.prefetcher) clearInterval(this.prefetcher);
    this.decoder?.kill("SIGKILL");
    this.encoder?.stdin?.end();
    this.encoder?.kill("SIGTERM");
    this.onDrained?.();
  }

  private log(...args: unknown[]) {
    console.log(`[${this.radio.slug}]`, ...args);
  }

  // ------------------------------------------------------------ encoder

  private startEncoder() {
    if (this.stopped) return;
    const url = `${env.MEDIAMTX_RTSP}/${this.radio.slug}`;
    const enc = spawn(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "warning",
        "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", String(CHANNELS), "-i", "pipe:0",
        "-c:a", "aac", "-b:a", "160k",
        "-f", "rtsp", "-rtsp_transport", "tcp", url,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    enc.stderr!.on("data", (d) => this.log("encoder:", String(d).trim()));
    enc.stdin!.on("error", () => {}); // EPIPE when ffmpeg dies; handled by 'exit'
    enc.on("exit", (code) => {
      if (this.encoder === enc) this.encoder = null;
      if (this.stopped) return;
      this.log(`encoder exited (${code}), restarting`);
      setTimeout(() => this.startEncoder(), 2000);
    });
    this.encoder = enc;
    this.clockStart = performance.now();
    this.written = 0;
    this.log(`publishing to ${url}`);
  }

  /** Writes exactly as much PCM as wall-clock time says is due. */
  private tick() {
    const stdin = this.encoder?.stdin;
    if (!stdin?.writable) return;
    const now = performance.now();
    let due = alignDown(Math.floor(((now - this.clockStart) * BYTES_PER_SEC) / 1000)) - this.written;
    if (due > BYTES_PER_SEC * 2) {
      // The event loop stalled; don't blast a burst at the encoder, just resync.
      this.clockStart = now - (this.written * 1000) / BYTES_PER_SEC;
      due = alignDown(Math.floor((BYTES_PER_SEC * TICK_MS) / 1000));
    }
    if (due <= 0) return;
    stdin.write(this.take(due));
    this.written += due;

    if (this.decoder && !this.decoderDone && this.pendingBytes < LOW_WATER) this.decoder.stdout?.resume();
    if (this.onDrained && this.decoderDone && this.pendingBytes === 0) {
      const cb = this.onDrained;
      this.onDrained = null;
      cb();
    }
  }

  /** Pops `n` bytes of track audio, zero-padded (silence) if there isn't enough. */
  private take(n: number): Buffer {
    const out = Buffer.alloc(n);
    let off = 0;
    while (off < n && this.pending.length) {
      const head = this.pending[0];
      const len = Math.min(head.length, n - off);
      head.copy(out, off, 0, len);
      off += len;
      if (len === head.length) this.pending.shift();
      else this.pending[0] = head.subarray(len);
    }
    this.pendingBytes -= off;
    return out;
  }

  private clearPending() {
    this.pending = [];
    this.pendingBytes = 0;
  }

  // ------------------------------------------------------------ playback

  /** Decodes `file` into the pending buffer; resolves once it has all been aired. */
  private play(itemId: string, file: string): Promise<Outcome> {
    return new Promise<Outcome>((resolve) => {
      let outcome: Outcome = "played";
      let gotAudio = false;
      const dec = spawn(
        "ffmpeg",
        [
          "-hide_banner", "-loglevel", "error", "-nostdin",
          "-i", file, "-vn",
          "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
          "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", String(CHANNELS), "pipe:1",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      this.decoder = dec;
      this.decoderDone = false;

      dec.stdout!.on("data", (chunk: Buffer) => {
        if (outcome === "skipped") return; // late data after a skip kill
        gotAudio = true;
        this.pending.push(chunk);
        this.pendingBytes += chunk.length;
        if (this.pendingBytes > HIGH_WATER) dec.stdout!.pause();
      });
      dec.stderr!.on("data", (d) => this.log("decoder:", String(d).trim()));
      dec.on("close", (code) => {
        // Keep the stream frame-aligned for whatever plays next.
        const extra = this.pendingBytes % FRAME;
        if (extra) {
          const last = this.pending[this.pending.length - 1];
          this.pending[this.pending.length - 1] = last.subarray(0, last.length - extra);
          this.pendingBytes -= extra;
        }
        if (code !== 0 && outcome === "played" && !gotAudio) outcome = "failed";
        this.decoderDone = true;
        if (this.decoder === dec) this.decoder = null;
      });

      // An admin skip flips the row's status; poll for it while on air.
      const watcher = setInterval(async () => {
        try {
          const row = await db.query.queueItems.findFirst({
            columns: { status: true },
            where: eq(queueItems.id, itemId),
          });
          if (row?.status !== "playing") {
            outcome = "skipped";
            dec.kill("SIGKILL");
            this.clearPending();
          }
        } catch (e) {
          this.log("skip watcher:", e);
        }
      }, 1000);

      this.onDrained = () => {
        clearInterval(watcher);
        resolve(this.stopped ? "skipped" : outcome);
      };
    });
  }

  private upcoming(limit: number) {
    return db
      .select({ id: queueItems.id, track: { id: tracks.id, sourceUrl: tracks.sourceUrl, title: tracks.title } })
      .from(queueItems)
      .innerJoin(tracks, eq(tracks.id, queueItems.trackId))
      .where(and(eq(queueItems.radioId, this.radio.id), eq(queueItems.status, "queued")))
      .orderBy(asc(queueItems.createdAt))
      .limit(limit);
  }

  private async prefetch() {
    try {
      for (const item of await this.upcoming(PREFETCH)) {
        this.cache.ensure(item.track).catch(() => {}); // failures surface when it's their turn
      }
    } catch (e) {
      this.log("prefetch:", e);
    }
  }

  private async loop() {
    while (!this.stopped) {
      try {
        const next = await this.upcoming(1);
        if (next.length === 0) {
          await sleep(1500);
          continue;
        }
        void this.prefetch();
        const [item] = next;

        let file: string;
        try {
          file = await this.cache.ensure(item.track);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.log(`fetch failed for "${item.track.title}": ${msg}`);
          await db
            .update(queueItems)
            .set({ status: "failed", error: msg.slice(0, 500), endedAt: new Date() })
            .where(and(eq(queueItems.id, item.id), eq(queueItems.status, "queued")));
          continue;
        }

        // Claim it only now, so "now playing" never shows a track we're still fetching.
        const claimed = await db
          .update(queueItems)
          .set({ status: "playing", startedAt: new Date() })
          .where(and(eq(queueItems.id, item.id), eq(queueItems.status, "queued")))
          .returning({ id: queueItems.id });
        if (!claimed.length) continue; // removed while we were downloading

        this.log(`on air: ${item.track.title}`);
        const outcome = await this.play(item.id, file);
        if (outcome !== "skipped") {
          await db
            .update(queueItems)
            .set({
              status: outcome,
              endedAt: new Date(),
              error: outcome === "failed" ? "Could not decode audio" : null,
            })
            .where(and(eq(queueItems.id, item.id), eq(queueItems.status, "playing")));
        }
      } catch (e) {
        this.log("loop error:", e);
        await sleep(3000);
      }
    }
  }
}
