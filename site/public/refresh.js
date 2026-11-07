/* The top bar's two timers: the time until the next nightly run and the
   next same-day cut, in hours and minutes, or, while a run is under way,
   the time it was due.

   The runs are fixed times of the UTC day (src/refresh.tsx holds the
   schedules, read from the two workflows). Each timer is a label over a
   figure (.refresh-left). The server writes the figure from its own clock,
   with the schedule in data-refresh-runs ("12:30", or "11:45 13:45 ...")
   and the word for a run due in data-now; the hour and minute forms and
   the under-way words sit on the group (data-hm, data-m, data-since,
   data-since-short, data-reload, data-reload-short). This script rewrites
   the figure on each minute from the visitor's clock and leaves the label
   alone. Without it the server's figure stands.

   A run starts at its scheduled time, but its data appears later: GitHub
   starts a scheduled job late, and the nightly then loads, checks and
   deploys. So a timer carries the stamp of the data the page was built
   from (data-data-at, an ISO UTC time: the nightly's for the daily timer,
   the last same-day cut's for the sub-daily one), and a run is under way
   from its scheduled time until that stamp is later than it. The figure
   then reads "Under way since 13:45" in the visitor's clock ("Since 13:45"
   below 1440 px, where the bar is tight), and this script asks
   /refresh.json (data-refresh-key names the timer's field) for the current
   stamps every three minutes while the timers are on screen, and at no
   other time. When a stamp passes the run, the countdown resumes and a
   link to reload goes beside the timers, once, since the page still shows
   the older data.

   Only a page drawn from the same-day notices (a Pro reader's band)
   carries the sub-daily stamp, so the server never reads the search
   database for any other page. On those pages the timer counts down, and
   when its run's time comes while the page is open it reads as under way,
   provisionally, and the same requests start; the first stamp they bring
   decides from then on. A page opened within a run's usual length of its
   scheduled time (RUN_MINUTES) asks once at load, since the visitor may
   have come in mid-run; otherwise nothing is asked before the run's time.

   A template travels as pieces, its text and the names of its slots in
   turn ("{h} h {m} min" is ["", "h", " h ", "m", " min"]), so no page
   carries an unfilled placeholder. src/refresh.tsx imports the functions
   below for the server's figure, so the rule has one copy; the part that
   touches the page runs only in a browser, and refreshLoop takes the page
   and the clock as arguments, so the tests run it without one. */

const DAY_MS = 86400000;

// How often a page whose timer is under way asks for the stamps.
export const POLL_MS = 3 * 60000;
// Where it asks (src/index.tsx).
export const STAMPS_PATH = "/refresh.json";

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

/** The day's run times as minutes after midnight UTC, the ones that read. @param {readonly string[]} runs */
function minutesOf(runs) {
  const out = [];
  for (const run of runs) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(run).trim());
    if (m) out.push(Number(m[1]) * 60 + Number(m[2]));
  }
  return out;
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
  for (const minutes of minutesOf(runs)) {
    let at = day + minutes * 60000;
    if (at < now) at += DAY_MS;
    if (next === null || at < next) next = at;
  }
  return next;
}

/**
 * The last run strictly before an instant: the latest of the day's times
 * today or, when none has come yet, yesterday. Null when no time reads.
 * @param {number} at
 * @param {readonly string[]} runs
 * @returns {number | null}
 */
export function lastRunBefore(at, runs) {
  const day = Math.floor(at / DAY_MS) * DAY_MS;
  let last = null;
  for (const minutes of minutesOf(runs)) {
    let t = day + minutes * 60000;
    if (t >= at) t -= DAY_MS;
    if (last === null || t > last) last = t;
  }
  return last;
}

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/;

/**
 * A data stamp as milliseconds: an ISO UTC time ("2026-11-07T13:52:10Z"),
 * as the server writes it, or null for anything else.
 * @param {unknown} value
 * @returns {number | null}
 */
export function stampMs(value) {
  if (typeof value !== "string" || !STAMP.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A timer's state at an instant. A run is under way ("running") from its
 * scheduled time until the data stamp is later than that time. The stamp's
 * own run is the last scheduled time before it; the next scheduled time
 * after that one is either still to come, and the countdown's target, or
 * has come, and the refresh is under way since then (when several have
 * come with no newer data, since the first of them). A stamp the visitor's
 * clock reads as later than now is taken as it is: a slow clock must not
 * turn a delivered run back into one under way. With no stamp the
 * countdown runs to the next scheduled time, as before stamps. Null when
 * no time reads.
 * @param {number} now
 * @param {readonly string[]} runs
 * @param {string | null | undefined} dataAt
 * @returns {{ state: "countdown", target: number } | { state: "running", since: number } | null}
 */
export function refreshState(now, runs, dataAt) {
  const stamp = stampMs(dataAt);
  if (stamp === null) {
    const target = nextRunAt(now, runs);
    return target === null ? null : { state: "countdown", target };
  }
  const ran = lastRunBefore(stamp, runs);
  const next = ran === null ? null : nextRunAt(ran + 1, runs);
  if (next === null) return null;
  return next <= now ? { state: "running", since: next } : { state: "countdown", target: next };
}

/**
 * A countdown's figure: whole minutes to the target, rounded down, so a
 * page kept in a cache for a few minutes never reads later than the run;
 * "now" within its last minute.
 * @param {number} now
 * @param {number} target
 * @param {{ now: string, hm: readonly string[], m: readonly string[] }} words
 * @returns {string}
 */
export function countdownText(now, target, words) {
  const minutes = Math.floor((target - now) / 60000);
  if (minutes < 1) return words.now;
  return minutes < 60 ? fill(words.m, { m: minutes }) : fill(words.hm, { h: Math.floor(minutes / 60), m: minutes % 60 });
}

/**
 * The countdown to the next run, from the schedule alone. Null when no time reads.
 * @param {number} now
 * @param {readonly string[]} runs
 * @param {{ now: string, hm: readonly string[], m: readonly string[] }} words
 * @returns {string | null}
 */
export function refreshText(now, runs, words) {
  const at = nextRunAt(now, runs);
  return at === null ? null : countdownText(now, at, words);
}

/**
 * "13:45": an instant's hours and minutes in UTC (the server, which cannot
 * know the visitor's zone) or on the clock running the script (in a
 * browser the visitor's zone, which the countdowns already count in).
 * @param {number} ms
 * @param {boolean} utc
 * @returns {string}
 */
export function clockTime(ms, utc) {
  const d = new Date(ms);
  const h = utc ? d.getUTCHours() : d.getHours();
  const m = utc ? d.getUTCMinutes() : d.getMinutes();
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * A run under way as its two figures: whole ("Under way since 13:45") and
 * short ("Since 13:45"), which the stylesheet shows below 1440 px.
 * @param {number} since
 * @param {{ since: readonly string[], since_short: readonly string[] }} words
 * @param {boolean} utc
 * @returns {{ full: string, short: string }}
 */
export function runningText(since, words, utc) {
  const time = clockTime(since, utc);
  return { full: fill(words.since, { time }), short: fill(words.since_short, { time }) };
}

/**
 * @typedef {{ now: string, hm: readonly string[], m: readonly string[], since: readonly string[], since_short: readonly string[] }} Words
 * @typedef {{ text: string } | { full: string, short: string }} Figure
 * @typedef {{ key: string, runs: readonly string[], dataAt: string | null, show: (figure: Figure) => void }} Timer
 */

// How long a run usually takes, in minutes, by the timer's key: a page
// opened that soon after a scheduled run, on a timer with no stamp, asks
// once at load whether the run's data is in (the visitor may have come in
// mid-run). The nightly loads, checks and deploys within about three hours
// of its start; a same-day cut, GitHub's late start included, within one.
export const DAILY_RUN_MINUTES = 180;
export const SAME_DAY_RUN_MINUTES = 60;
/** @type {Readonly<Record<string, number>>} */
export const RUN_MINUTES = { daily: DAILY_RUN_MINUTES, same_day: SAME_DAY_RUN_MINUTES };

/**
 * The script's loop over the page's timers, with the page and the clock
 * passed in. tick() writes each figure and, while a timer is under way, the
 * timers are on screen (active; they are hidden below 1200 px) and no
 * request is pending, asks for the stamps POLL_MS later; never otherwise.
 * When an answer's stamp for a timer under way is later than its run, the
 * timer takes that stamp, its countdown resumes, and reload() is called,
 * once for the page's life. An answer that does not read changes nothing,
 * and the tick after it asks again while the run is still under way.
 *
 * A timer the page gave no stamp (the sub-daily one, on a page without the
 * same-day band) counts down as before; when its run's time comes while
 * the page is open, it reads as under way since then, provisionally, and
 * the requests start. Its first stamp in an answer then decides as a
 * stamp on the page would, the reload link included; an answer with no
 * stamp for it (none known, or too old to say) ends the provisional state
 * and the countdown goes on to the next run. begin() is the first tick, and
 * asks once at once when such a timer's last run is more recent than its
 * RUN_MINUTES, since the visitor may have come in mid-run; that answer can
 * put the timer under way (the stamp is older than the run) but offers no
 * reload, since the page was not drawn under way.
 * @param {{ timers: Timer[], words: Words, now: () => number, fetchStamps: () => Promise<unknown>,
 *   reload: () => void, wait: (fn: () => void, ms: number) => void, active?: () => boolean, utc?: boolean }} io
 */
export function refreshLoop(io) {
  let pending = false;
  let reloaded = false;
  /** @type {Promise<void> | null} */
  let inflight = null;
  // For a timer without a stamp: the run its countdown was counting to
  // (due), and the run it reads as under way since, provisionally.
  const due = io.timers.map(() => /** @type {number | null} */ (null));
  const provisional = io.timers.map(() => /** @type {number | null} */ (null));
  const stamped = (/** @type {Timer} */ timer) => stampMs(timer.dataAt) !== null;
  const canAsk = () => !pending && (!io.active || io.active());

  /** @returns {{ state: "countdown", target: number } | { state: "running", since: number } | null} */
  function stateOf(/** @type {number} */ now, /** @type {number} */ i) {
    const timer = io.timers[i];
    if (!stamped(timer) && provisional[i] !== null) return { state: "running", since: /** @type {number} */ (provisional[i]) };
    return refreshState(now, timer.runs, timer.dataAt);
  }

  function tick() {
    const now = io.now();
    let running = false;
    io.timers.forEach((timer, i) => {
      // The run this unstamped timer was counting to has come while the page was open.
      if (!stamped(timer) && provisional[i] === null && due[i] !== null && now >= /** @type {number} */ (due[i])) {
        provisional[i] = lastRunBefore(now + 1, timer.runs);
      }
      const state = stateOf(now, i);
      due[i] = !stamped(timer) && state && state.state === "countdown" ? state.target : null;
      if (!state) return;
      if (state.state === "running") {
        running = true;
        timer.show(runningText(state.since, io.words, !!io.utc));
      } else {
        timer.show({ text: countdownText(now, state.target, io.words) });
      }
    });
    if (running && canAsk()) {
      pending = true;
      io.wait(() => { inflight = poll(); }, POLL_MS);
    }
    return running;
  }

  function begin() {
    const running = tick();
    const now = io.now();
    const midRun = io.timers.some((timer) => {
      const minutes = RUN_MINUTES[timer.key];
      const last = lastRunBefore(now + 1, timer.runs);
      return !stamped(timer) && minutes !== undefined && last !== null && now - last < minutes * 60000;
    });
    if (midRun && canAsk()) {
      pending = true;
      inflight = poll();
    }
    return running;
  }

  async function poll() {
    let stamps = null;
    try {
      stamps = await io.fetchStamps();
    } catch (e) {
      stamps = null;
    }
    const now = io.now();
    let arrived = false;
    if (stamps && typeof stamps === "object") {
      io.timers.forEach((timer, i) => {
        const value = /** @type {Record<string, unknown>} */ (stamps)[timer.key];
        const fresh = stampMs(value);
        const before = stateOf(now, i);
        if (stamped(timer)) {
          if (before && before.state === "running" && fresh !== null && fresh > before.since) {
            timer.dataAt = /** @type {string} */ (value);
            arrived = true;
          }
          return;
        }
        const wasRunning = provisional[i] !== null;
        provisional[i] = null;
        if (fresh === null) return;
        timer.dataAt = /** @type {string} */ (value);
        const after = refreshState(now, timer.runs, timer.dataAt);
        if (wasRunning && after && after.state === "countdown") arrived = true;
      });
    }
    pending = false;
    if (arrived && !reloaded) {
      reloaded = true;
      io.reload();
    }
    tick();
  }

  // The request last started, settled: for the tests, which wait on it.
  const idle = () => inflight || Promise.resolve();

  return { begin, tick, poll, idle };
}

/**
 * The stamps /refresh.json answers, or null for an answer that is not one.
 * The page's fetch in a browser; the tests pass their own.
 * @param {(url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean, json: () => Promise<unknown> }>} fetchImpl
 * @returns {Promise<unknown>}
 */
export async function fetchStamps(fetchImpl) {
  const res = await fetchImpl(STAMPS_PATH, { headers: { accept: "application/json" } });
  return res.ok ? res.json() : null;
}

/** @param {Element | null} el @param {string} name @returns {string[]} */
function pieces(el, name) {
  try {
    const v = JSON.parse((el && el.getAttribute(name)) || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch (e) {
    return [];
  }
}

// A figure into its slot: plain text for a countdown, the two forms for a
// run under way, each written only when it changed.
function showIn(left, figure) {
  if ("text" in figure) {
    if (left.children.length || left.textContent !== figure.text) left.textContent = figure.text;
    return;
  }
  const short = left.querySelector(".refresh-short");
  const full = left.querySelector(".refresh-full");
  if (short && full && short.textContent === figure.short && full.textContent === figure.full) return;
  const a = document.createElement("span");
  a.className = "refresh-short";
  a.textContent = figure.short;
  const b = document.createElement("span");
  b.className = "refresh-full";
  b.textContent = figure.full;
  left.replaceChildren(a, b);
}

function start() {
  const group = document.querySelector(".refresh-timers");
  if (!group) return;
  const elements = [...group.querySelectorAll("[data-refresh-runs]")];
  const timers = [];
  for (const el of elements) {
    const left = el.querySelector(".refresh-left");
    if (!left) continue;
    timers.push({
      key: el.getAttribute("data-refresh-key") || "",
      runs: (el.getAttribute("data-refresh-runs") || "").split(" "),
      dataAt: el.getAttribute("data-data-at"),
      show: (figure) => showIn(left, figure),
    });
  }
  const loop = refreshLoop({
    timers,
    words: {
      // One page, one language: each timer carries the same word for a run due.
      now: (elements[0] && elements[0].getAttribute("data-now")) || "",
      hm: pieces(group, "data-hm"), m: pieces(group, "data-m"),
      since: pieces(group, "data-since"), since_short: pieces(group, "data-since-short"),
    },
    now: () => Date.now(),
    fetchStamps: () => fetchStamps(fetch),
    // A plain link after the timers, short to 1599 px (public/styles.css).
    // The click reloads rather than following the link, so the browser asks
    // the server again instead of showing the copy it kept.
    reload: () => {
      if (group.querySelector(".refresh-reload")) return;
      const link = document.createElement("a");
      link.className = "refresh-reload";
      link.href = "";
      const short = document.createElement("span");
      short.className = "refresh-short";
      short.textContent = group.getAttribute("data-reload-short") || "";
      const full = document.createElement("span");
      full.className = "refresh-full";
      full.textContent = group.getAttribute("data-reload") || "";
      link.append(short, full);
      link.addEventListener("click", (e) => { e.preventDefault(); location.reload(); });
      const last = elements[elements.length - 1];
      if (last) last.after(link);
      else group.append(link);
    },
    wait: (fn, ms) => { setTimeout(fn, ms); },
    // Below 1200 px the stylesheet hides the timers: nothing to ask for then.
    active: () => getComputedStyle(group).display !== "none",
  });
  loop.begin();
  // On the minute, as public/countdown.js does; a background tab's timers may
  // run late, so the line is read again when the page is shown.
  const schedule = () => {
    setTimeout(() => { loop.tick(); schedule(); }, 60000 - (Date.now() % 60000) + 50);
  };
  schedule();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") loop.tick(); });
}

if (typeof document !== "undefined") start();
