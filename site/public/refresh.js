/* The top bar's two timers: the time until the next nightly run and the
   next same-day cut, in hours and minutes.

   The runs are fixed times of the UTC day (src/refresh.tsx holds the
   schedules, read from the two workflows), so the time left comes from the
   visitor's clock alone: no request, nothing read. Each timer is a label
   over the time left (.refresh-left). The server writes the time left from
   its own clock, with the schedule in data-refresh-runs ("12:30", or
   "11:45 13:45 ...") and the word for a run due in data-now; the hour and
   minute forms sit on the group (data-hm, data-m). This script rewrites
   the time left on each minute and leaves the label alone. Without it the
   server's figure stands.

   A template travels as pieces, its text and the names of its slots in
   turn ("{h} h {m} min" is ["", "h", " h ", "m", " min"]), so no page
   carries an unfilled placeholder. src/refresh.tsx imports the functions
   below for the server's figure, so the rule has one copy; the part that
   touches the page runs only in a browser. */

const DAY_MS = 86400000;

/**
 * A dictionary template as pieces.
 * @param {string} template
 * @returns {string[]}
 */
export function templatePieces(template) {
  return String(template).split(/\{(\w+)\}/);
}

/** @param {readonly string[]} pieces @param {Record<string, string | number>} vars */
function fill(pieces, vars) {
  return pieces.map((p, i) => (i % 2 ? (p in vars ? String(vars[p]) : "") : p)).join("");
}

/**
 * The next run at or after an instant: the soonest of the day's times (UTC,
 * "HH:MM") today or, once passed, tomorrow. Null when no time reads.
 * @param {number} now
 * @param {readonly string[]} runs
 * @returns {number | null}
 */
export function nextRunAt(now, runs) {
  const day = Math.floor(now / DAY_MS) * DAY_MS;
  let next = null;
  for (const run of runs) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(run).trim());
    if (!m) continue;
    let at = day + (Number(m[1]) * 60 + Number(m[2])) * 60000;
    if (at < now) at += DAY_MS;
    if (next === null || at < next) next = at;
  }
  return next;
}

/**
 * The timer's figure: whole minutes to the next run, rounded down, so a
 * page kept in a cache for a few minutes never reads later than the run;
 * "now" within its last minute. Null when no time reads.
 * @param {number} now
 * @param {readonly string[]} runs
 * @param {{ now: string, hm: readonly string[], m: readonly string[] }} words
 * @returns {string | null}
 */
export function refreshText(now, runs, words) {
  const at = nextRunAt(now, runs);
  if (at === null) return null;
  const minutes = Math.floor((at - now) / 60000);
  if (minutes < 1) return words.now;
  return minutes < 60 ? fill(words.m, { m: minutes }) : fill(words.hm, { h: Math.floor(minutes / 60), m: minutes % 60 });
}

function pieces(el, name) {
  try {
    const v = JSON.parse((el && el.getAttribute(name)) || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch (e) {
    return [];
  }
}

function tick() {
  const now = Date.now();
  for (const timer of document.querySelectorAll("[data-refresh-runs]")) {
    const group = timer.closest("[data-hm]");
    const words = { now: timer.getAttribute("data-now") || "", hm: pieces(group, "data-hm"), m: pieces(group, "data-m") };
    const text = refreshText(now, (timer.getAttribute("data-refresh-runs") || "").split(" "), words);
    const left = timer.querySelector(".refresh-left");
    if (text && left && left.textContent !== text) left.textContent = text;
  }
}

// On the minute, as public/countdown.js does; a background tab's timers may
// run late, so the line is read again when the page is shown.
function schedule() {
  setTimeout(() => { tick(); schedule(); }, 60000 - (Date.now() % 60000) + 50);
}

if (typeof document !== "undefined") {
  tick();
  schedule();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tick(); });
}
