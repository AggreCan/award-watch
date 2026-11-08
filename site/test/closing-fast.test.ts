// The Worker's closing states (src/closing.ts) skip work public/closing.js
// does: each value's date and instant are kept once worked out, and a value
// dated two days or more from the Eastern date is judged by its date alone.
// These tests hold the two equal over values on every side of the shortcut's
// edges: the hours either side of Eastern midnight, both daylight saving
// changes, every zone form a file could write, dates and times that roll
// over, and text that is not a date.
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, closingPassed as refPassed, closingState as refState, easternDay } from "../public/closing.js";
import { clearClosingCache, clockAt, closingPassed, closingSoonByDay, closingSoonCount, tenderState } from "../src/closing";
import { CLOSING_SOON_DAYS } from "../src/constants";

beforeEach(() => clearClosingCache());

// Instants around the edges: Eastern midnight in winter (05:00 UTC) and
// summer (04:00 UTC), the minutes either side, both changes of 2026, and the
// tests' own clock.
const NOWS = [
  "2026-10-31T16:00:00Z", "2026-11-07T04:59:59Z", "2026-11-07T05:00:00Z", "2026-11-07T05:00:01Z",
  "2026-07-15T03:59:59Z", "2026-07-15T04:00:00Z", "2026-07-15T23:30:00Z", "2026-11-01T05:30:00Z",
  "2026-11-01T06:30:00Z", "2026-03-08T06:59:00Z", "2026-03-08T07:01:00Z", "2026-12-31T23:59:59Z",
  "2027-01-01T04:59:59Z", "2026-11-07T15:00:00Z",
].map((s) => Date.parse(s));

const TIMES = ["", "T00:00:00", "T00:00", "T01:30:00", "T02:30:00", "T04:59:59", "T05:00:00", "T12:00:00", "T19:00:00", "T23:59:59", "T23:59:99", " 14:00"];
const ZONES = [
  "", "Z", "-05:00", "-0400", "+14:00", "+15:59", "+16:00", "-12:00", "-16:00", "+99:00", " ET", " PT", " NST", " HNE",
  " Pacific/Kiritimati", " Asia/Manila", " Pacific/Pago_Pago", " Eastern Standard Time", " Etc/GMT-14", " (EST)",
];
// Text the file could hold that is not a date, or a date that rolls over.
const ODD = [
  "", "soon", "2026-1-1", "2026-02-30T10:00:00", "2026-11-00T10:00:00", "2026-10-99T10:00:00", "2026-13-01T10:00:00",
  "2026-11-07T24:00:00", "2026-11-05T99:00:00", "2026-11-09T23:99:00", "2026-11-07T10:00:00.123Z", "0026-11-07T10:00:00",
  "2026-11-07garbage", "2026-11-07T10", "9999-12-31T23:59:59",
];

function valuesAround(now: number): string[] {
  const today = easternDay(now);
  const out: string[] = [...ODD];
  for (let d = -4; d <= 10; d++) {
    const day = addDays(today, d);
    for (const time of TIMES) {
      if (!time) {
        out.push(day);
        continue;
      }
      for (const zone of ZONES) out.push(`${day}${time}${zone}`);
    }
  }
  return out;
}

describe("the closing states match public/closing.js", () => {
  // About 4.7 s alone, past vitest's 5 s default when the whole suite shares
  // the cores; the time is not under test here (cpu-budget.test.ts times it).
  it("for closingPassed and the state, every value at every clock, read twice", { timeout: 30_000 }, () => {
    let checked = 0;
    for (const now of NOWS) {
      const clock = clockAt(now);
      for (const v of valuesAround(now)) {
        for (let pass = 0; pass < 2; pass++) {
          const passed = closingPassed(v, clock);
          if (passed !== refPassed(v, now)) throw new Error(`closingPassed ${JSON.stringify(v)} at ${new Date(now).toISOString()}`);
          const state = tenderState("open", v, clock);
          if (state !== (v ? refState(v, now, CLOSING_SOON_DAYS) : "open")) {
            throw new Error(`state ${JSON.stringify(v)} at ${new Date(now).toISOString()}: ${state}`);
          }
        }
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(30000);
  });

  it("for the counts the rail and the home page show", () => {
    for (const now of NOWS) {
      const clock = clockAt(now);
      const values = [...valuesAround(now), null];
      const want = values.filter((v) => !!v && refState(v, now, CLOSING_SOON_DAYS) === "closing").length;
      expect(closingSoonCount(values, clock)).toBe(want);
      const byDay = closingSoonByDay(values, clock);
      expect(byDay.today + byDay.day1 + byDay.day2 + byDay.later).toBe(want);
    }
  });

  it("gives the same answer whatever was asked before, and after the kept values are dropped", () => {
    const now = Date.parse("2026-11-07T05:00:00Z");
    const v = "2026-11-07T00:30:00";
    // 00:30 Eastern on the 7th is 05:30 UTC, half an hour after this clock.
    expect(closingPassed(v, clockAt(now))).toBe(false);
    expect(closingPassed(v, clockAt(now + 3_600_000))).toBe(true);
    clearClosingCache();
    expect(closingPassed(v, clockAt(now + 3_600_000))).toBe(true);
    expect(closingPassed(v, clockAt(now))).toBe(false);
  });
});
