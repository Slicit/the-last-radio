import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  api,
  type QueueItem,
  type RadioDetail,
  type RadioStats,
  type RadioSummary,
  type SongRecord,
  type SongSort,
  type StreamStatus,
} from "@/lib/api";

export const useRadios = () =>
  useQuery({
    queryKey: ["radios"],
    queryFn: () => api.get<{ radios: RadioSummary[] }>("/radios"),
    refetchInterval: 10_000,
    select: (d) => d.radios,
  });

export const useRadio = (slug: string | undefined) =>
  useQuery({
    queryKey: ["radio", slug],
    queryFn: async () => {
      const d = await api.get<RadioDetail>(`/radios/${slug}`);
      // Remember how far our clock is from the server's for progress bars.
      return { ...d, clockSkewMs: Date.parse(d.serverTime) - Date.now() };
    },
    enabled: !!slug,
    refetchInterval: 5_000,
  });

export const useStream = (slug: string | undefined) =>
  useQuery({
    queryKey: ["radio", slug, "stream"],
    queryFn: () => api.get<StreamStatus>(`/radios/${slug}/stream`),
    enabled: !!slug,
    refetchInterval: 10_000,
  });

export const useHistory = (slug: string | undefined) =>
  useQuery({
    queryKey: ["radio", slug, "history"],
    queryFn: () => api.get<{ items: QueueItem[] }>(`/radios/${slug}/history?limit=50`),
    enabled: !!slug,
    refetchInterval: 20_000,
    select: (d) => d.items,
  });

export const useStats = (slug: string | undefined) =>
  useQuery({
    queryKey: ["radio", slug, "stats"],
    queryFn: () => api.get<RadioStats>(`/radios/${slug}/stats`),
    enabled: !!slug,
    refetchInterval: 30_000,
  });

export const useSongs = (slug: string | undefined, sort: SongSort) =>
  useQuery({
    queryKey: ["radio", slug, "songs", sort],
    queryFn: () => api.get<{ songs: SongRecord[] }>(`/radios/${slug}/songs?sort=${sort}`),
    enabled: !!slug,
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
    select: (d) => d.songs,
  });

/** Seconds into the on-air track, as heard by a listener `delaySec` behind live. */
export function useElapsed(startedAt: string | null | undefined, clockSkewMs = 0, delaySec = 0) {
  const compute = () =>
    startedAt ? Math.max(0, (Date.now() + clockSkewMs - Date.parse(startedAt)) / 1000 - delaySec) : 0;
  const [elapsed, setElapsed] = useState(compute);
  useEffect(() => {
    setElapsed(compute());
    if (!startedAt) return;
    const t = window.setInterval(() => setElapsed(compute()), 500);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, clockSkewMs, delaySec]);
  return elapsed;
}

/** Re-renders every second; for countdowns. */
export function useNow(active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}
