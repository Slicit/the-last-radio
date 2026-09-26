import type { Radio } from "../db/schema.js";

type Hours = Pick<Radio, "hoursEnabled" | "hoursDays" | "hoursStart" | "hoursEnd" | "timezone">;

export type HoursStatus = {
  open: boolean;
  /** Next opening while closed, in the station's local time. */
  next: { inDays: number; weekday: number; time: string } | null;
  /** Today's closing time while open (null when always on). */
  closesAt: string | null;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Weekday (0 = Sunday) and minutes since midnight, as a wall clock in `tz` shows them. */
function localClock(now: Date, tz: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { weekday: WEEKDAYS.indexOf(get("weekday")), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/**
 * A window belongs to the day it starts on. When end <= start it runs past
 * midnight (22:00–02:00 on Friday covers Saturday 01:00); start == end means
 * the whole day.
 */
export function hoursStatus(h: Hours, now = new Date()): HoursStatus {
  if (!h.hoursEnabled) return { open: true, next: null, closesAt: null };
  const { weekday, minutes } = localClock(now, h.timezone);
  const start = toMinutes(h.hoursStart);
  const end = toMinutes(h.hoursEnd);
  const on = (d: number) => h.hoursDays.includes(((d % 7) + 7) % 7);

  let open: boolean;
  if (start < end) open = on(weekday) && minutes >= start && minutes < end;
  else if (start === end) open = on(weekday);
  else open = (on(weekday) && minutes >= start) || (on(weekday - 1) && minutes < end);

  if (open) return { open, next: null, closesAt: start === end ? null : h.hoursEnd };

  for (let inDays = 0; inDays <= 7; inDays++) {
    const d = (weekday + inDays) % 7;
    if (on(d) && (inDays > 0 || minutes < start)) {
      return { open, next: { inDays, weekday: d, time: h.hoursStart }, closesAt: null };
    }
  }
  return { open, next: null, closesAt: null }; // no days selected
}
