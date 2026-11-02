/* Closing times: the one copy of the rule, for the Worker and the browser.

   CanadaBuys publishes a notice's closing time in Eastern time and its file
   carries no zone ("2026-11-26T14:00:00"). A value without a zone is read as
   wall time in America/Toronto, daylight saving included (the clocks went
   back on 2026-11-01, so 14:00 on 2026-10-31 is 18:00 UTC and 14:00 on
   2026-11-02 is 19:00 UTC). A value that carries a zone ("Z", "-05:00", a
   zone name) is read in that zone. A value with a date and no time is a day:
   it passes when the Eastern date moves past it.

   src/closing.ts imports this module for the pages; public/tenders.js and
   public/countdown.js import it in the browser. Nothing here touches the
   page, so the tests import it as it is. */

export const CLOSING_ZONE = "America/Toronto";
export const DAY_MS = 86400000;

const VALUE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2}|[A-Za-z][A-Za-z ()/_-]*)?)?/;

// Zone names a file might write, by the zone that keeps their clocks.
const NAMED = {
  ET: CLOSING_ZONE, EST: CLOSING_ZONE, EDT: CLOSING_ZONE, HE: CLOSING_ZONE, HNE: CLOSING_ZONE, HAE: CLOSING_ZONE,
  PT: "America/Vancouver", PST: "America/Vancouver", PDT: "America/Vancouver",
  MT: "America/Edmonton", MST: "America/Edmonton", MDT: "America/Edmonton",
  CT: "America/Winnipeg", CST: "America/Winnipeg", CDT: "America/Winnipeg",
  AT: "America/Halifax", AST: "America/Halifax", ADT: "America/Halifax",
  NT: "America/St_Johns", NST: "America/St_Johns", NDT: "America/St_Johns",
  UTC: "UTC", GMT: "UTC",
};

const FORMATS = {};

/** @param {string} zone */
function format(zone) {
  if (!FORMATS[zone]) {
    FORMATS[zone] = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  }
  return FORMATS[zone];
}

/** The wall clock in a zone at an instant, as the fields of a UTC date. @param {string} zone @param {number} ms */
function wallAt(zone, ms) {
  const parts = {};
  for (const p of format(zone).formatToParts(new Date(ms))) parts[p.type] = p.value;
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
}

/**
 * The instant a wall time in a zone names. The zone's offsets a day either
 * side give the candidates, and the ones that read back as the wall time
 * fit: when the clocks repeat an hour the first fits, and a time they skip
 * reads an hour later.
 * @param {number} wall the wall time's fields as a UTC timestamp
 * @param {string} zone
 */
export function zonedInstant(wall, zone) {
  const before = wallAt(zone, wall - DAY_MS) - (wall - DAY_MS);
  const after = wallAt(zone, wall + DAY_MS) - (wall + DAY_MS);
  const fits = [wall - before, wall - after].filter((t) => wallAt(zone, t) === wall);
  return fits.length ? Math.min(...fits) : wall - before;
}

/** @param {string} name */
function zoneOf(name) {
  const key = name.trim().replace(/[()]/g, "").toUpperCase();
  if (NAMED[key]) return NAMED[key];
  try {
    format(name.trim());
    return name.trim();
  } catch (e) {
    return CLOSING_ZONE;
  }
}

/**
 * A closing value's parts: the date, the time when it has one, and the zone
 * as written (null when the value carries none).
 * @param {string | null | undefined} value
 * @returns {{ day: string, hh: string | null, mm: string | null, zone: string | null } | null}
 */
export function closingParts(value) {
  const m = VALUE.exec(value || "");
  if (!m) return null;
  return { day: `${m[1]}-${m[2]}-${m[3]}`, hh: m[4] || null, mm: m[5] || null, zone: m[7] ? m[7].trim() : null };
}

/**
 * The instant a closing value names, in milliseconds since 1970, or null
 * for a value with no time (a day) or none at all.
 * @param {string | null | undefined} value
 * @returns {number | null}
 */
export function closingInstant(value) {
  const m = VALUE.exec(value || "");
  if (!m || !m[4]) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
  if (!Number.isFinite(wall)) return null;
  const zone = m[7] ? m[7].trim() : "";
  if (zone === "Z") return wall;
  const offset = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
  if (offset) return wall - (offset[1] === "-" ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60000;
  return zonedInstant(wall, zone ? zoneOf(zone) : CLOSING_ZONE);
}

/** The Eastern date at an instant, "2026-11-02". @param {number} ms */
export function easternDay(ms) {
  return new Date(wallAt(CLOSING_ZONE, ms)).toISOString().slice(0, 10);
}

/** @param {string} day @param {number} n */
export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Whether a notice's closing has passed at an instant: its closing time is
 * at or before it, or, for a day without a time, the Eastern date is after it.
 * @param {string | null | undefined} value
 * @param {number} now
 */
export function closingPassed(value, now) {
  if (!value) return false;
  const at = closingInstant(value);
  if (at !== null) return at <= now;
  const parts = closingParts(value);
  return !!parts && parts.day < easternDay(now);
}

/**
 * An open notice's state at an instant: "closed" once its closing has passed,
 * "closing" when it closes within soonDays of the Eastern date, else "open".
 * @param {string | null | undefined} value
 * @param {number} now
 * @param {number} soonDays
 */
export function closingState(value, now, soonDays) {
  if (!value) return "open";
  if (closingPassed(value, now)) return "closed";
  const parts = closingParts(value);
  return parts && parts.day <= addDays(easternDay(now), soonDays) ? "closing" : "open";
}

/**
 * The line under a closing time while it is near, from the visitor's clock:
 * "closes in 12 min" and "closes in 3 h 12 min" in the last 6 hours, "closes
 * today at 14:00 ET" earlier on the closing day, the hours and minutes again
 * within a day, then whole days ("closes in 2 days"). Minutes round up, so
 * the line never reads 0. Null once the time has come.
 * @param {number} closesAt
 * @param {number} now
 * @param {string} time the closing time as the page prints it ("14:00 ET")
 * @param {{ in_min: string, in_hm: string, in_day: string, in_days: string, today_at: string }} words
 * @returns {string | null}
 */
export function countdownText(closesAt, now, time, words) {
  const left = closesAt - now;
  if (!(left > 0)) return null;
  const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  const minutes = Math.ceil(left / 60000);
  const hm = () => (minutes < 60 ? fill(words.in_min, { m: minutes }) : fill(words.in_hm, { h: Math.floor(minutes / 60), m: minutes % 60 }));
  if (left < 6 * 3600000) return hm();
  if (easternDay(closesAt) === easternDay(now)) return fill(words.today_at, { time });
  if (left < DAY_MS) return hm();
  const days = Math.floor(left / DAY_MS);
  return fill(days === 1 ? words.in_day : words.in_days, { n: days });
}
