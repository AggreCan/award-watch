// npm run figures (docs/guides.md, Figures): the guides' figures, captured from the site's own pages.
//
// 1. The Worker renders every page a figure in src/guides.ts is captured from, from the sample records in
//    figures/ and never from real ones (figures/render.test.ts under vitest.figures.config.ts), into a
//    temporary file.
// 2. Those pages are served over local HTTP beside public/, so their stylesheet, scripts and fonts load as on
//    the site. Nothing under /data/ is served.
// 3. One headless browser (Edge by default; FIGURES_BROWSER names another, such as Chrome) loads each figure's
//    page in each language, at each width and in each theme, waits for its fonts and layout, reads the box of
//    the figure's region and of each callout's target, and captures the region as WebP at device scale 2. The
//    wide image is the desktop layout (from 1000 px) at the widest viewport that keeps the region within the
//    figure's room in the guide's column (846 px less the frame's indent); the phone image is a 390 px
//    viewport.
// 4. In the same laid-out page it places each mark as the guide's stylesheet will draw it, at the scale the
//    guide shows that image (the numbers in scripts/guide-figure-marks.mjs), and refuses the figure when a
//    mark's edge or number covers any text inside the image, or a number falls outside it anywhere but into
//    the room on its left.
// 5. Only once every capture has worked: the images go to
//    public/figures/guides/<slug>/<id>.<lang>.<wide|phone>.<light|dark>.webp, the files of figures that no
//    longer exist are removed, and src/guide_figures.gen.ts is written.
//
// One line a figure: its image sizes in CSS pixels, the viewport and the scale the guide shows it at. Any
// error stops the run with a non-zero exit and changes no file: a region or target missing or not visible at
// some language, width or theme, a region the column cannot hold, light and dark laid out apart, a mark on
// text.
//
// --check <dir> then loads each guide holding a figure at 1440 and 390 px, light and dark, in both languages:
// it fails on a horizontal scroll, on a figure showing the wrong file or the wrong number of marks, or on the
// hidden theme's file having been fetched, and saves each figure as it shows into dir.
//
// The browser is closed on every way out by its whole process tree, then any process still carrying this
// run's debugging port or profile is stopped, and the profile is removed. The local server is closed too.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { COLUMN, MARK, PHONE_COLUMN } from "./guide-figure-marks.mjs";

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(SITE, "public");
const OUT = join(PUBLIC, "figures", "guides");
const GEN = join(SITE, "src", "guide_figures.gen.ts");
const BROWSER = process.env.FIGURES_BROWSER || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

// The room a figure has: the guide's column less the frame's indent, at the full measure and on a 390 px
// phone. The site's desktop layout, the rail beside the content, starts at 1000 px. Text in a figure is never
// shown below 0.85 of its size.
const ROOM = COLUMN - MARK.indent;
const PHONE_ROOM = PHONE_COLUMN - MARK.indent;
const PHONE = 390;
const DESKTOP_MIN = 1000;
const WIDE_START = 1440;
const SCALE = 2;
const LEGIBLE = 0.85;
// Room around the region in the image, in CSS px, so a mark's edge on a field at the region's edge falls
// inside the image.
const MARGIN = 6;
const WIDTHS = ["wide", "phone"];
const THEMES = ["light", "dark"];
const LANGS = ["en", "fr"];
// The samples' clock: their data date at noon in Ottawa, as figures/render.test.ts renders them.
const NOW = "2026-11-13T17:00:00Z";

const args = process.argv.slice(2);
const checkAt = args.includes("--check") ? args[args.indexOf("--check") + 1] : null;
if (args.includes("--check") && !checkAt) fail("--check needs a folder");

function fail(message) {
  throw new Error(message);
}

// -- 1. the pages ---------------------------------------------------------------------------

function renderPages(dumpFile) {
  // The Workers pool reads site/.dev.vars into the test bindings; it must not exist.
  if (existsSync(join(SITE, ".dev.vars"))) fail("site/.dev.vars exists; remove it before rendering the figures' pages");
  rmSync(dumpFile, { force: true });
  const vitest = join(SITE, "node_modules", "vitest", "vitest.mjs");
  const run = spawnSync(process.execPath, [vitest, "run", "--config", "vitest.figures.config.ts"], {
    cwd: SITE, env: { ...process.env, FIGURES_DUMP: dumpFile }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0 || !existsSync(dumpFile)) {
    process.stderr.write(`${run.stdout ?? ""}${run.stderr ?? ""}\n`);
    fail("rendering the figures' pages failed (vitest.figures.config.ts)");
  }
  const parts = new Map();
  for (const line of readFileSync(dumpFile, "utf8").split("\n")) {
    const m = /^@@FIG (\S+) (\d+) (\d+) (\S+)$/.exec(line.trim());
    if (!m) continue;
    const [, name, i, n, data] = m;
    if (!parts.has(name)) parts.set(name, { n: Number(n), chunks: new Map() });
    parts.get(name).chunks.set(Number(i), data);
  }
  const text = (name) => {
    const p = parts.get(name);
    if (!p || p.chunks.size !== p.n) fail(`the rendered item ${name} is incomplete`);
    return Buffer.concat([...Array(p.n).keys()].map((i) => Buffer.from(p.chunks.get(i), "base64"))).toString("utf8");
  };
  const manifest = JSON.parse(text("manifest"));
  const pages = new Map(manifest.items.map((item) => [item.path, text(item.name)]));
  return { manifest, pages };
}

// -- 2. the server ----------------------------------------------------------------------------

const TYPES = {
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8", ".json": "application/json",
};

function serve(pages) {
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    const page = pages.get(url);
    if (page !== undefined) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(page);
      return;
    }
    let path;
    try {
      path = decodeURIComponent(url.split("?")[0]);
    } catch {
      path = "/";
    }
    const file = join(PUBLIC, path);
    if (path.startsWith("/data/") || !file.startsWith(PUBLIC + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

// -- 3. the browser -------------------------------------------------------------------------

// The run's debugging port and profile, chosen when the browser opens: a port nothing answers on, so the
// sweep below can only ever reach this run's own browser (another headless browser may be running here).
let PORT = 0;
let PROFILE = "";
let launched = false;
let browser = null;
let server = null;
let socket = null;

// Every way out: the socket, the browser's whole tree, any process still carrying this run's port or
// profile, the profile, the server. Safe to call more than once, and synchronous so an exit handler can.
function closeAll() {
  try { socket?.close(); } catch {}
  socket = null;
  if (browser && browser.pid) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(browser.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try { process.kill(-browser.pid, "SIGKILL"); } catch {}
    }
  }
  browser = null;
  if (!launched) {
    // No browser was started: there is nothing of this run's to sweep.
  } else if (process.platform === "win32") {
    const exe = basename(BROWSER).replace(/'/g, "");
    const sweep = "Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and " +
      `($_.Name -eq 'msedge.exe' -or $_.Name -eq 'chrome.exe' -or $_.Name -eq '${exe}') -and ` +
      `($_.CommandLine -like '*--remote-debugging-port=${PORT}*' -or $_.CommandLine -like '*edge-figures-${PORT}*') } | ` +
      "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
    spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", sweep], { stdio: "ignore" });
  } else {
    spawnSync("pkill", ["-KILL", "-f", `--remote-debugging-port=${PORT}`], { stdio: "ignore" });
  }
  for (let i = 0; launched && i < 10 && existsSync(PROFILE); i++) {
    try { rmSync(PROFILE, { recursive: true, force: true }); } catch { spawnSync(process.execPath, ["-e", "setTimeout(()=>{},300)"]); }
  }
  if (server) {
    server.closeAllConnections?.();
    server.close();
    server = null;
  }
}

process.on("exit", closeAll);
for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) {
  process.on(signal, () => {
    closeAll();
    process.exit(130);
  });
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// A port no process answers on, whose profile folder is not there.
async function freePort() {
  for (let i = 0; i < 50; i++) {
    const port = 9300 + Math.floor(Math.random() * 600);
    if (existsSync(join(tmpdir(), `edge-figures-${port}`))) continue;
    const answers = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) }).then(() => true, () => false);
    if (!answers) return port;
  }
  fail("found no free debugging port");
}

async function openBrowser() {
  if (!existsSync(BROWSER)) fail(`no browser at ${BROWSER}; set FIGURES_BROWSER to Edge or Chrome`);
  PORT = await freePort();
  PROFILE = join(tmpdir(), `edge-figures-${PORT}`);
  launched = true;
  mkdirSync(PROFILE, { recursive: true });
  browser = spawn(BROWSER, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--mute-audio", "--force-color-profile=srgb", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "about:blank",
  ], { stdio: "ignore", detached: process.platform !== "win32" });
  let page = null;
  for (let i = 0; i < 150 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = list.find((t) => t.type === "page") ?? null;
    } catch {}
    if (!page) await sleep(200);
  }
  if (!page) fail("the browser did not answer on its debugging port");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, no) => {
    socket.addEventListener("open", ok, { once: true });
    socket.addEventListener("error", () => no(new Error("the browser's socket did not open")), { once: true });
  });
  let id = 0;
  const pending = new Map();
  const waiting = [];
  socket.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method) {
      for (const w of waiting.filter((x) => x.method === m.method)) {
        waiting.splice(waiting.indexOf(w), 1);
        w.ok(m.params);
      }
    }
  });
  const send = (method, params = {}) => new Promise((ok, no) => {
    const n = ++id;
    const timer = setTimeout(() => {
      pending.delete(n);
      no(new Error(`${method}: no answer`));
    }, 60_000);
    pending.set(n, (m) => {
      clearTimeout(timer);
      if (m.error) no(new Error(`${method}: ${m.error.message}`));
      else ok(m.result);
    });
    socket.send(JSON.stringify({ id: n, method, params }));
  });
  const next = (method) => new Promise((ok, no) => {
    const w = { method, ok };
    waiting.push(w);
    setTimeout(() => {
      if (waiting.includes(w)) {
        waiting.splice(waiting.indexOf(w), 1);
        no(new Error(`${method}: timed out`));
      }
    }, 60_000);
  });
  await send("Page.enable");
  await send("Runtime.enable");
  // The pages' own scripts read the samples' clock and Ottawa's time zone, as the Worker rendered them.
  await send("Emulation.setTimezoneOverride", { timezoneId: "America/Toronto" });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => { const R = Date, d = Date.parse(${JSON.stringify(NOW)}) - R.now();
      class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + d); } static now() { return R.now() + d; } }
      globalThis.Date = D; })();`,
  });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) fail(`in the page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  return { send, next, evaluate };
}

// -- 4. measuring and capturing ------------------------------------------------------------

let base = "";

async function load(cdp, path, width, height, theme) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: SCALE, mobile: width < 700 });
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" }] });
  const loaded = cdp.next("Page.loadEventFired");
  await cdp.send("Page.navigate", { url: `${base}${path}` });
  await loaded;
  await settle(cdp);
}

// Fonts loaded and two frames laid out, not a fixed wait.
async function settle(cdp) {
  await cdp.evaluate("(async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return true; })()");
}

async function setView(cdp, width, height, theme) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: SCALE, mobile: width < 700 });
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" }] });
  await settle(cdp);
}

// The image's box: the region's, MARGIN around it within the page, rounded out to whole CSS px; each target's
// box (the union of its visible matches inside the region, inside the image), which is the mark's own box,
// the page drawing its edge outside it; and the box of every line of text inside the image (a Range over each
// text node), all in CSS px from the image's corner.
const MEASURE = `(region, targets, margin) => {
  window.scrollTo(0, 0);
  const shown = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }); };
  const all = [...document.querySelectorAll(region)];
  if (all.length !== 1) return { error: "the region " + region + " matches " + all.length + " elements" };
  const r = all[0];
  if (!shown(r)) return { error: "the region " + region + " is not visible" };
  const b = r.getBoundingClientRect();
  const x0 = Math.max(0, Math.floor(b.left + scrollX) - margin), y0 = Math.max(0, Math.floor(b.top + scrollY) - margin);
  const x1 = Math.min(document.documentElement.clientWidth, Math.ceil(b.right + scrollX) + margin), y1 = Math.ceil(b.bottom + scrollY) + margin;
  const crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const boxes = targets.map((t) => {
    let found;
    try { found = [...r.querySelectorAll(t)]; } catch (e) { return { error: "the target " + t + " is not a selector" }; }
    const seen = found.filter(shown);
    if (!seen.length) return { error: found.length ? "the target " + t + " is not visible" : "the target " + t + " is missing" };
    let l = Infinity, tp = Infinity, rt = -Infinity, bt = -Infinity;
    for (const el of seen) { const e = el.getBoundingClientRect(); l = Math.min(l, e.left); tp = Math.min(tp, e.top); rt = Math.max(rt, e.right); bt = Math.max(bt, e.bottom); }
    const left = Math.max(x0, l + scrollX), top = Math.max(y0, tp + scrollY);
    const right = Math.min(x1, rt + scrollX), bottom = Math.min(y1, bt + scrollY);
    if (right - left < 4 || bottom - top < 4) return { error: "the target " + t + " lies outside the region" };
    return { x: left - x0, y: top - y0, w: right - left, h: bottom - top };
  });
  // Painted text only: a text node in a hidden element is not, and a line is cut to every box that clips it
  // (an overflow other than visible, a clip or a clip-path on an ancestor), so text a one-pixel box hides for
  // screen readers (a restacked table's head) counts for nothing.
  const clips = new Map();
  const clipOf = (el) => {
    if (clips.has(el)) return clips.get(el);
    let box = el.parentElement && el.parentElement !== document.documentElement ? clipOf(el.parentElement) : { l: -Infinity, t: -Infinity, r: Infinity, b: Infinity };
    const s = getComputedStyle(el);
    if (s.overflowX !== "visible" || s.overflowY !== "visible" || (s.clip && s.clip !== "auto") || s.clipPath !== "none") {
      const e = el.getBoundingClientRect();
      box = { l: Math.max(box.l, e.left), t: Math.max(box.t, e.top), r: Math.min(box.r, e.right), b: Math.min(box.b, e.bottom) };
    }
    clips.set(el, box);
    return box;
  };
  const text = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const words = n.nodeValue.trim();
    const p = n.parentElement;
    if (!words || !p || !p.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const clip = clipOf(p);
    range.selectNodeContents(n);
    for (const q of range.getClientRects()) {
      const ql = Math.max(q.left, clip.l), qt = Math.max(q.top, clip.t), qr = Math.min(q.right, clip.r), qb = Math.min(q.bottom, clip.b);
      if (qr - ql <= 0.5 || qb - qt <= 0.5) continue;
      const left = Math.max(x0, ql + scrollX), top = Math.max(y0, qt + scrollY);
      const right = Math.min(x1, qr + scrollX), bottom = Math.min(y1, qb + scrollY);
      if (right - left > 0.5 && bottom - top > 0.5) text.push({ x: left - x0, y: top - y0, w: right - left, h: bottom - top, words: words.slice(0, 40) });
    }
  }
  const root = document.documentElement;
  return { crop, boxes, text, scroll: root.scrollWidth > root.clientWidth };
}`;

// Each mark as the guide's stylesheet draws it over an image shown at `scale` (its CSS px over the image's
// CSS px), in the image's CSS px: the four strips of its edge, `gap` out from the box, and its number's square
// to the left of the edge, its top level with the edge's top. The figure is refused when a strip or a square
// covers a line of text inside the image, when a strip falls outside the image, or when a square falls outside
// it anywhere but on the left, and on the left past the room the frame's indent and the column's padding give.
function placementErrors(m, scale) {
  const gap = MARK.gap / scale, edge = MARK.edge / scale, square = MARK.square / scale;
  const room = (MARK.indent + MARK.padding - MARK.clear) / scale;
  const slack = 0.25;
  const covers = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > slack && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > slack;
  const errors = [];
  m.boxes.forEach((b, i) => {
    const out = gap + edge;
    const o = { x: b.x - out, y: b.y - out, w: b.w + 2 * out, h: b.h + 2 * out };
    const strips = [
      { name: "edge's top", x: o.x, y: o.y, w: o.w, h: edge },
      { name: "edge's bottom", x: o.x, y: o.y + o.h - edge, w: o.w, h: edge },
      { name: "edge's left side", x: o.x, y: o.y, w: edge, h: o.h },
      { name: "edge's right side", x: o.x + o.w - edge, y: o.y, w: edge, h: o.h },
    ];
    const num = { name: "number", x: o.x - square, y: o.y, w: square, h: square };
    for (const part of [...strips, num]) {
      const hit = m.text.find((t) => covers(part, t));
      if (hit) errors.push(`callout ${i + 1}: its ${part.name} covers the text "${hit.words}"`);
    }
    for (const s of strips) {
      if (s.x < -slack || s.y < -slack || s.x + s.w > m.crop.w + slack || s.y + s.h > m.crop.h + slack) errors.push(`callout ${i + 1}: its ${s.name} falls outside the image`);
    }
    if (num.y < -slack || num.y + num.h > m.crop.h + slack) errors.push(`callout ${i + 1}: its number falls above or below the image`);
    if (num.x < -room - slack) errors.push(`callout ${i + 1}: its number hangs ${Math.round((-num.x - room) * scale)} px past the room on the image's left`);
  });
  return errors;
}

async function measure(cdp, fig, where) {
  const m = await cdp.evaluate(`(${MEASURE})(${JSON.stringify(fig.region)}, ${JSON.stringify(fig.targets)}, ${MARGIN})`);
  if (m.error) fail(`${where}: ${m.error}`);
  m.boxes.forEach((box, i) => {
    if (box.error) fail(`${where}, callout ${i + 1}: ${box.error}`);
  });
  return m;
}

// The pixel size a WebP file states: lossless (VP8L), lossy (VP8) or extended (VP8X).
function webpSize(buf) {
  if (buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WEBP") return null;
  const chunk = buf.toString("latin1", 12, 16);
  if (chunk === "VP8L") {
    const b = buf.readUInt32LE(21);
    return { w: (b & 0x3fff) + 1, h: ((b >>> 14) & 0x3fff) + 1, lossless: true };
  }
  if (chunk === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, lossless: false };
  if (chunk === "VP8X") return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1, lossless: null };
  return null;
}

// The browser's WebP encoder is lossy at every quality (100 gave files more than twice the size of 90 and
// larger than a PNG), and lossless WebP would need an encoder this repository does not carry; 90 keeps the
// text's edges clean at twice the CSS size.
const QUALITY = 90;

async function capture(cdp, crop, where) {
  const clip = { x: crop.x, y: crop.y, width: crop.w, height: crop.h, scale: 1 };
  const r = await cdp.send("Page.captureScreenshot", { format: "webp", quality: QUALITY, clip, captureBeyondViewport: false, fromSurface: true });
  const best = Buffer.from(r.data, "base64");
  const size = webpSize(best);
  if (!size || size.w !== crop.w * SCALE || size.h !== crop.h * SCALE) {
    fail(`${where}: the capture is ${size ? `${size.w}x${size.h}` : "not a WebP file"}, not ${crop.w * SCALE}x${crop.h * SCALE}`);
  }
  return best;
}

// The marks placementErrors refuses, gathered over the whole run so one run names them all.
const misplaced = [];

const pct = (v, whole) => Math.round((v / whole) * 10000) / 100;

async function shootFigure(cdp, fig) {
  const out = { files: new Map(), entry: { slug: fig.slug, page: fig.page, region: fig.region, targets: fig.targets } };
  const lines = [];
  for (const lang of LANGS) {
    const path = lang === "en" ? fig.page : `${fig.page}${fig.page.includes("?") ? "&" : "?"}lang=fr`;
    out.entry[lang] = {};
    for (const width of WIDTHS) {
      let viewport = width === "phone" ? PHONE : WIDE_START;
      let height = 2400;
      const where = (theme) => `${fig.id} (${lang}, ${width}, ${theme})`;
      await load(cdp, path, viewport, height, "light");
      let m = await measure(cdp, fig, where("light"));
      // The widest desktop layout whose region the figure's room in the guide's column holds.
      for (let i = 0; width === "wide" && m.crop.w > ROOM; i++) {
        viewport -= m.crop.w - ROOM;
        if (viewport < DESKTOP_MIN || i > 6) fail(`${where("light")}: the region is ${m.crop.w} px wide at every desktop width; the figure has ${ROOM}`);
        await setView(cdp, viewport, height, "light");
        m = await measure(cdp, fig, where("light"));
      }
      if (m.crop.y + m.crop.h + 8 > height) {
        height = m.crop.y + m.crop.h + 200;
        await setView(cdp, viewport, height, "light");
        m = await measure(cdp, fig, where("light"));
      }
      const shown = width === "wide" ? Math.min(1, ROOM / m.crop.w) : Math.min(1, PHONE_ROOM / m.crop.w);
      if (shown < LEGIBLE) fail(`${where("light")}: the region is ${m.crop.w} px wide, shown at ${shown.toFixed(3)} of its size`);
      const placed = placementErrors(m, shown);
      for (const p of placed) misplaced.push(`${where("light")}: ${p}`);
      let first = null;
      for (const theme of THEMES) {
        if (theme !== "light") {
          await setView(cdp, viewport, height, theme);
          m = await measure(cdp, fig, where(theme));
        }
        if (first) {
          const apart = (a, b) => Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1 || Math.abs(a.w - b.w) > 1 || Math.abs(a.h - b.h) > 1;
          if (apart(first.crop, m.crop)) fail(`${where(theme)}: the region is laid out apart from the light theme's`);
          m.boxes.forEach((box, i) => {
            if (apart(first.boxes[i], box)) fail(`${where(theme)}, callout ${i + 1}: laid out apart from the light theme's`);
          });
        } else {
          first = m;
        }
        const file = `${fig.slug}/${fig.id}.${lang}.${width}.${theme}.webp`;
        out.files.set(file, await capture(cdp, m.crop, where(theme)));
      }
      out.entry[lang][width] = {
        width: first.crop.w, height: first.crop.h, viewport,
        boxes: first.boxes.map((b) => [pct(b.x, first.crop.w), pct(b.y, first.crop.h), pct(b.w, first.crop.w), pct(b.h, first.crop.h)]),
      };
      lines.push(`${lang} ${width} ${first.crop.w}x${first.crop.h} at ${viewport} px, shown at ${shown.toFixed(3)}`);
    }
  }
  const bytes = [...out.files.values()].reduce((s, b) => s + b.length, 0);
  console.log(`${fig.id} (${fig.slug}): ${lines.join("; ")}; ${out.files.size} files, ${Math.round(bytes / 1024)} KB`);
  return out;
}

// -- 5. writing -------------------------------------------------------------------------------

function listFiles(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full, `${prefix}${name}/`) : [`${prefix}${name}`];
  });
}

function removeEmptyDirs(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      removeEmptyDirs(full);
      if (readdirSync(full).length === 0) rmdirSync(full);
    }
  }
}

function writeAll(results) {
  const keep = new Set();
  for (const r of results) {
    for (const [file, buf] of r.files) {
      const full = join(OUT, ...file.split("/"));
      mkdirSync(dirname(full), { recursive: true });
      const old = existsSync(full) ? readFileSync(full) : null;
      if (!old || !old.equals(buf)) writeFileSync(full, buf);
      keep.add(file);
    }
  }
  const stale = listFiles(OUT).filter((f) => !keep.has(f));
  for (const f of stale) rmSync(join(OUT, ...f.split("/")));
  removeEmptyDirs(OUT);
  // One line a target and one an image, so a run's diff shows what moved.
  const entries = results.map((r) => {
    const e = r.entry;
    const lines = [
      `  ${JSON.stringify(r.id)}: {`,
      `    slug: ${JSON.stringify(e.slug)}, page: ${JSON.stringify(e.page)}, region: ${JSON.stringify(e.region)},`,
      "    targets: [",
      ...e.targets.map((t) => `      ${JSON.stringify(t)},`),
      "    ],",
    ];
    for (const lang of LANGS) {
      lines.push(`    ${lang}: {`);
      for (const width of WIDTHS) lines.push(`      ${width}: ${JSON.stringify(e[lang][width])},`);
      lines.push("    },");
    }
    lines.push("  },");
    return lines.join("\n");
  }).join("\n");
  const gen = [
    "// Written by scripts/make-guide-figures.mjs (npm run figures) and by nothing else: each guide figure's image",
    "// sizes and the place of each of its marks, read from the pages rendered from the sample records in site/figures/.",
    "// Do not edit it by hand: change the figure in src/guides.ts or the sample records and run the tool again",
    "// (docs/guides.md, Figures).",
    "",
    'import type { FigureEntry } from "./guides";',
    "",
    results.length ? `export const GUIDE_FIGURES: Readonly<Record<string, FigureEntry>> = {\n${entries}\n};` : "export const GUIDE_FIGURES: Readonly<Record<string, FigureEntry>> = {};",
    "",
  ].join("\n");
  writeFileSync(GEN, gen);
  const files = listFiles(OUT);
  const sizes = files.map((f) => ({ f, bytes: statSync(join(OUT, ...f.split("/"))).size }));
  const total = sizes.reduce((s, x) => s + x.bytes, 0);
  const largest = sizes.sort((a, b) => b.bytes - a.bytes)[0];
  console.log(`${files.length} files under public/figures/guides, ${Math.round(total / 1024)} KB` +
    (largest ? `; the largest ${largest.f}, ${Math.round(largest.bytes / 1024)} KB` : "") + (stale.length ? `; ${stale.length} removed` : ""));
}

// -- 6. the check -------------------------------------------------------------------------------

const CHECK = `(figures) => {
  const root = document.documentElement;
  const out = { scroll: root.scrollWidth > root.clientWidth, figures: [] };
  for (const f of figures) {
    const el = document.getElementById("figure-" + f.id);
    if (!el) { out.figures.push({ id: f.id, missing: true }); continue; }
    const imgs = [...el.querySelectorAll("img")].filter((i) => i.checkVisibility());
    const marks = [...el.querySelectorAll(".fig-mark")].filter((m) => m.checkVisibility());
    const legend = el.querySelectorAll(".fig-legend li").length;
    out.figures.push({ id: f.id, shown: imgs.map((i) => i.currentSrc), complete: imgs.every((i) => i.complete && i.naturalWidth > 0), marks: marks.length, legend });
  }
  out.fetched = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.includes("/figures/guides/"));
  return out;
}`;

async function check(cdp, manifest, dir) {
  mkdirSync(dir, { recursive: true });
  const guides = manifest.items.filter((i) => i.kind === "guide");
  for (const item of guides) {
    const slug = item.path.split("?")[0].slice("/guides/".length);
    const figs = manifest.figures.filter((f) => f.slug === slug);
    for (const [viewport, width] of [[1440, "wide"], [PHONE, "phone"]]) {
      for (const theme of THEMES) {
        const where = `${item.path} at ${viewport} px, ${theme}`;
        await load(cdp, item.path, viewport, 1200, theme);
        // Bring each figure into view so its lazy image loads, then wait for it.
        for (const f of figs) {
          await cdp.evaluate(`(async () => { const el = document.getElementById("figure-${f.id}"); if (!el) return false; el.scrollIntoView({ block: "center" });
            await new Promise((r) => setTimeout(r, 50)); const img = [...el.querySelectorAll("img")].find((i) => i.checkVisibility());
            if (img) { try { await img.decode(); } catch {} } return true; })()`);
        }
        await settle(cdp);
        const c = await cdp.evaluate(`(${CHECK})(${JSON.stringify(figs)})`);
        if (c.scroll) fail(`${where}: the page scrolls sideways`);
        for (const f of figs) {
          const got = c.figures.find((x) => x.id === f.id);
          const want = `/figures/guides/${slug}/${f.id}.${item.lang}.${width}.${theme}.webp`;
          if (!got || got.missing) fail(`${where}: no figure ${f.id}`);
          if (got.shown.length !== 1 || !got.shown[0].endsWith(want)) fail(`${where}: figure ${f.id} shows ${got.shown.join(", ") || "nothing"}, not ${want}`);
          if (!got.complete) fail(`${where}: figure ${f.id}'s image did not load`);
          if (got.marks !== f.targets.length || got.legend !== f.targets.length) {
            fail(`${where}: figure ${f.id} shows ${got.marks} marks and ${got.legend} legend lines for ${f.targets.length} callouts`);
          }
          const other = THEMES.find((x) => x !== theme);
          if (c.fetched.some((n) => n.includes(`/${f.id}.`) && n.includes(`.${other}.webp`))) fail(`${where}: figure ${f.id}'s ${other} file was fetched`);
          // The figure as it shows, for the eye: the page at its top with the bar in the flow, the viewport grown
          // to hold the figure, its image decoded and painted, the capture inside the viewport.
          const box = await cdp.evaluate(`(() => { document.querySelector(".topbar")?.style.setProperty("position", "static");
            window.scrollTo(0, 0); const el = document.getElementById("figure-${f.id}");
            const b = el.getBoundingClientRect(); return { x: Math.max(0, Math.floor(b.left) - 24), y: Math.max(0, Math.floor(b.top) - 24),
            w: Math.ceil(b.width) + 48, h: Math.ceil(b.height) + 48 }; })()`);
          box.w = Math.min(box.w, viewport - box.x);
          await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport, height: Math.max(1200, box.y + box.h + 40), deviceScaleFactor: SCALE, mobile: viewport < 700 });
          await cdp.evaluate(`(async () => { window.scrollTo(0, 0); const img = [...document.getElementById("figure-${f.id}").querySelectorAll("img")].find((i) => i.checkVisibility());
            if (img) { try { await img.decode(); } catch {} } await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return true; })()`);
          const shot = await cdp.send("Page.captureScreenshot", {
            format: "png", clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 1 }, captureBeyondViewport: false,
          });
          writeFileSync(join(dir, `${slug}.${f.id}.${item.lang}.${viewport}.${theme}.png`), Buffer.from(shot.data, "base64"));
        }
        console.log(`checked ${where}: ${figs.length} figure${figs.length === 1 ? "" : "s"}, no sideways scroll`);
      }
    }
  }
}

// -- the run ----------------------------------------------------------------------------------

function render() {
  const dump = join(tmpdir(), `guide-figures-${process.pid}.txt`);
  try {
    return renderPages(dump);
  } finally {
    rmSync(dump, { force: true });
  }
}

async function main() {
  const { manifest, pages } = render();
  const ids = manifest.figures.map((f) => f.id);
  if (new Set(ids).size !== ids.length) fail("two figures share an id");
  server = await serve(pages);
  base = `http://127.0.0.1:${server.address().port}`;
  const cdp = await openBrowser();
  const results = [];
  for (const fig of manifest.figures) results.push({ id: fig.id, ...(await shootFigure(cdp, fig)) });
  // Every mark on text, in every figure, at once.
  if (misplaced.length) fail(`${misplaced.length} marks would cover text or fall outside their room:\n  ${misplaced.join("\n  ")}`);
  writeAll(results);
  if (checkAt) {
    // The guides drawn again, now with the positions just written.
    const again = render();
    for (const [path, html] of again.pages) pages.set(path, html);
    await check(cdp, again.manifest, resolve(checkAt));
  }
}

main().then(
  () => {
    closeAll();
    process.exit(0);
  },
  (e) => {
    console.error(`figures: ${e instanceof Error ? e.message : String(e)}`);
    closeAll();
    process.exit(1);
  },
);
