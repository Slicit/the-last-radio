import { describe, expect, it } from "vitest";
import { hoursStatus } from "../../src/lib/schedule.js";

// specs/features/broadcast-hours.feature: "Whether a station is open"
const base = { hoursEnabled: true, timezone: "Europe/Paris" };
const office = { ...base, hoursDays: [1, 2, 3, 4, 5], hoursStart: "08:00", hoursEnd: "18:00" };
const fridayNights = { ...base, hoursDays: [5], hoursStart: "22:00", hoursEnd: "02:00" };
// 2026-09-28 is a Monday; Paris is UTC+2 then.
const at = (iso: string) => new Date(iso);

describe("Whether a station is open", () => {
  it.each([
    ["Mon 07:59 → opens today 8:00", office, "2026-09-28T05:59:00Z", { open: false, next: { inDays: 0, weekday: 1, time: "08:00" }, closesAt: null }],
    ["Mon 08:00 → open until 18:00", office, "2026-09-28T06:00:00Z", { open: true, next: null, closesAt: "18:00" }],
    ["Mon 18:00 → opens tomorrow", office, "2026-09-28T16:00:00Z", { open: false, next: { inDays: 1, weekday: 2, time: "08:00" }, closesAt: null }],
    ["Fri 19:00 → opens Monday", office, "2026-10-02T17:00:00Z", { open: false, next: { inDays: 3, weekday: 1, time: "08:00" }, closesAt: null }],
    ["Sat noon → opens Monday", office, "2026-10-03T10:00:00Z", { open: false, next: { inDays: 2, weekday: 1, time: "08:00" }, closesAt: null }],
    ["Fri 23:00 overnight window", fridayNights, "2026-10-02T21:00:00Z", { open: true, next: null, closesAt: "02:00" }],
    ["Sat 01:30 belongs to Friday's window", fridayNights, "2026-10-02T23:30:00Z", { open: true, next: null, closesAt: "02:00" }],
    ["Sat 02:00 → next Friday", fridayNights, "2026-10-03T00:00:00Z", { open: false, next: { inDays: 6, weekday: 5, time: "22:00" }, closesAt: null }],
    ["Fri 01:00 isn't after a Friday → opens tonight", fridayNights, "2026-10-01T23:00:00Z", { open: false, next: { inDays: 0, weekday: 5, time: "22:00" }, closesAt: null }],
    ["timezone: New York Mon 08:30", { ...office, timezone: "America/New_York" }, "2026-09-28T12:30:00Z", { open: true, next: null, closesAt: "18:00" }],
  ])("%s", (_name, hours, iso, expected) => {
    expect(hoursStatus(hours, at(iso))).toEqual(expected);
  });

  it("start == end means all day on the selected days", () => {
    const allDay = { ...base, hoursDays: [0, 1, 2, 3, 4, 5, 6], hoursStart: "00:00", hoursEnd: "00:00" };
    expect(hoursStatus(allDay, at("2026-10-03T10:00:00Z"))).toEqual({ open: true, next: null, closesAt: null });
  });

  it("is always open when hours are off", () => {
    expect(hoursStatus({ ...office, hoursEnabled: false }, at("2026-10-03T10:00:00Z")).open).toBe(true);
  });
});
