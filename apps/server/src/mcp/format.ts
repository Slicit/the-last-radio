// Plain-language formatting for MCP tool results.
import type { HoursStatus } from "../lib/schedule.js";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}h${String(m).padStart(2, "0")}`;
  return m ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
}

/** Seconds from now → "now", "in 4 min", "in 1h05". */
export function when(sec: number): string {
  if (sec < 30) return "now";
  if (sec < 3600) return `in ${Math.round(sec / 60)} min`;
  return `in ${fmtDuration(sec)}`;
}

export function ordinal(n: number): string {
  const suffix = { one: "st", two: "nd", few: "rd", other: "th" } as Record<string, string>;
  return `${n}${suffix[new Intl.PluralRules("en", { type: "ordinal" }).select(n)] ?? "th"}`;
}

export function nextOpeningText(h: HoursStatus): string {
  if (!h.next) return "no opening scheduled";
  const day = h.next.inDays === 0 ? "today" : h.next.inDays === 1 ? "tomorrow" : WEEKDAYS[h.next.weekday];
  return `opens ${day} at ${h.next.time} (station time)`;
}

type Item = {
  isFill: boolean;
  track: { title: string; artist: string | null; durationSec: number | null; isPreview?: boolean };
  pushedBy: { displayName: string } | null;
};

/** `"Title" by Artist (3:45), added by Polly` */
export function itemLine(i: Item): string {
  const by = i.isFill || !i.pushedBy ? "Alfred (the auto-DJ)" : i.pushedBy.displayName;
  const artist = i.track.artist ? ` by ${i.track.artist}` : "";
  const length = i.track.isPreview ? "only a 30-second SAMPLE" : fmtDuration(i.track.durationSec ?? 0);
  return `"${i.track.title}"${artist} (${length}), added by ${by}`;
}
