import Hls from "hls.js";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";

export type Station = { slug: string; name: string };
type Status = "idle" | "connecting" | "playing" | "offline";

type PlayerState = {
  station: Station | null;
  status: Status;
  volume: number;
  /** Seconds between the live edge and what the listener hears (HLS buffer). */
  latency: number;
  tune: (station: Station) => void;
  stop: () => void;
  setVolume: (v: number) => void;
};

const PlayerContext = createContext<PlayerState | null>(null);

const RETRY_MS = 4000;
const HEARTBEAT_MS = 20_000;

// crypto.randomUUID only exists in secure contexts (HTTPS/localhost), and the
// radio is often served over plain HTTP on a LAN; getRandomValues works everywhere.
function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function listenerId(): string {
  const key = "lr_listener";
  try {
    let id = localStorage.getItem(key);
    if (!id) localStorage.setItem(key, (id = randomId()));
    return id;
  } catch {
    return randomId();
  }
}

function storedVolume(): number {
  try {
    const v = Number(localStorage.getItem("lr_volume"));
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.8;
  } catch {
    return 0.8;
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const retryRef = useRef<number | null>(null);
  const [station, setStation] = useState<Station | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [volume, setVolumeState] = useState(storedVolume);
  const [latency, setLatency] = useState(0);

  if (!audioRef.current && typeof Audio !== "undefined") audioRef.current = new Audio();

  const teardown = useCallback(() => {
    if (retryRef.current) window.clearTimeout(retryRef.current);
    retryRef.current = null;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
  }, []);

  const connect = useCallback(
    (s: Station) => {
      teardown();
      const audio = audioRef.current!;
      const src = `/hls/${s.slug}/index.m3u8`;
      setStatus("connecting");

      const retry = () => {
        setStatus("offline");
        retryRef.current = window.setTimeout(() => connect(s), RETRY_MS);
      };

      if (Hls.isSupported()) {
        const hls = new Hls({ liveSyncDurationCount: 3, manifestLoadingMaxRetry: 2 });
        hlsRef.current = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          audio.play().catch(() => setStatus("idle"));
        });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) retry();
        });
        hls.loadSource(src);
        hls.attachMedia(audio);
      } else if (audio.canPlayType("application/vnd.apple.mpegurl")) {
        audio.src = src; // Safari plays HLS natively
        audio.play().catch(retry);
      } else {
        setStatus("offline");
      }
    },
    [teardown],
  );

  const tune = useCallback(
    (s: Station) => {
      setStation(s);
      connect(s);
    },
    [connect],
  );

  const stop = useCallback(() => {
    teardown();
    setStatus("idle");
  }, [teardown]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    try {
      localStorage.setItem("lr_volume", String(v));
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlaying = () => setStatus("playing");
    const onWaiting = () => setStatus((s) => (s === "playing" ? "connecting" : s));
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("waiting", onWaiting);
    return () => {
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("waiting", onWaiting);
    };
  }, []);

  // Track our HLS delay so the progress bar matches what the listener hears.
  useEffect(() => {
    if (status !== "playing") return;
    const t = window.setInterval(() => setLatency(hlsRef.current?.latency ?? 0), 1000);
    return () => window.clearInterval(t);
  }, [status]);

  // Listener count heartbeat.
  useEffect(() => {
    if (status !== "playing" || !station) return;
    const id = listenerId();
    const beat = () => api.post(`/radios/${station.slug}/listen`, { listenerId: id }).catch(() => {});
    beat();
    const t = window.setInterval(beat, HEARTBEAT_MS);
    return () => window.clearInterval(t);
  }, [status, station]);

  useEffect(() => teardown, [teardown]);

  return (
    <PlayerContext.Provider value={{ station, status, volume, latency, tune, stop, setVolume }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer outside PlayerProvider");
  return ctx;
}
