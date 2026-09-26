export function duration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "–:––";
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

export function hours(sec: number): string {
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
}

export function windowLabel(sec: number): string {
  if (sec % 3600 === 0) return `${sec / 3600} h`;
  if (sec % 60 === 0) return `${sec / 60} min`;
  return `${sec} s`;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
export function ago(iso: string): string {
  const diff = (Date.parse(iso) - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export const ALFRED = "Alfred";

/** Who added a song, for display. Alfred is the bot that tops up quiet queues. */
export function adderName(item: { isFill: boolean; pushedBy: { displayName: string } | null }): string {
  return item.isFill || !item.pushedBy ? ALFRED : item.pushedBy.displayName;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "today at 8:00", "tomorrow at 8:00", "Monday at 8:00" */
export function nextOpening(next: { inDays: number; weekday: number; time: string }): string {
  const time = next.time.replace(/^0(\d)/, "$1");
  if (next.inDays === 0) return `today at ${time}`;
  if (next.inDays === 1) return `tomorrow at ${time}`;
  return `${WEEKDAY_NAMES[next.weekday]} at ${time}`;
}

/** Short label for station cards and the player: "Closed · opens tomorrow at 8:00". */
export function closedLabel(hours: { open: boolean; next: { inDays: number; weekday: number; time: string } | null }) {
  if (hours.open) return null;
  return hours.next ? `Closed · opens ${nextOpening(hours.next)}` : "Closed";
}

/** "Mon–Fri, 8:00–18:00" (plus the timezone when it isn't the viewer's). */
export function hoursSummary(r: { hoursDays: number[]; hoursStart: string; hoursEnd: string; timezone: string }) {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // Show Monday first and collapse runs: "Mon–Fri", "Mon, Wed, Sat–Sun".
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => r.hoursDays.includes(d));
  const runs: number[][] = [];
  for (const d of order) {
    const last = runs.at(-1);
    const prev = last?.at(-1);
    if (last && prev !== undefined && (prev + 1) % 7 === d) last.push(d);
    else runs.push([d]);
  }
  const days =
    order.length === 7
      ? "Every day"
      : runs.map((run) => (run.length > 2 ? `${names[run[0]]}–${names[run.at(-1)!]}` : run.map((d) => names[d]).join(", "))).join(", ");
  const tz = r.timezone === Intl.DateTimeFormat().resolvedOptions().timeZone ? "" : ` (${r.timezone.replace(/_/g, " ")})`;
  const t = (s: string) => s.replace(/^0(\d)/, "$1");
  const span = r.hoursStart === r.hoursEnd ? "all day" : `${t(r.hoursStart)}–${t(r.hoursEnd)}`;
  return `${days}, ${span}${tz}`;
}
