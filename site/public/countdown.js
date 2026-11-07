/* The time left before a notice closes, under each closing-soon time.

   The server marks every notice it shows as closing soon (the amber chip)
   with its closing instant in UTC (data-closes), the closing time as the page
   prints it (data-time) and its reference (data-notice), on the element the
   line goes in. This script writes the line from the visitor's clock
   ("closes in 3 h 12 min", "closes today at 14:00 ET", "closes in 2 days";
   countdownText in closing.js) and rewrites it once a minute. When the
   instant passes, every chip of that notice on the page turns to "Closing
   date passed", the line goes, and each closing-soon count on the page
   (data-soon-count: the rail's, the home page's) drops by one, once per
   notice. Without the script the server's chip stands.

   public/tenders.js draws its own rows and its detail panel with the same
   marks and sends "aw:rows" after each draw, so they are read at once.

   A notice page's Documents panel opens with a line of its own (closing.ts
   closesLine), marked data-words="line": the same figure in the words of the
   block's "line" set ("Closes in 3 h 12 min"), and when the time comes the
   line reads "Closing date passed" instead of going.

   The words come from the page's JSON block (id "countdown-i18n"), so the
   script holds no copy of its own in either language. */
import { countdownText } from "./closing.js";

let data = {};
try { data = JSON.parse(document.getElementById("countdown-i18n").textContent) || {}; } catch (e) { data = {}; }
const words = data.words || {};
const lineWords = data.line || words;
let number = null;
try { number = new Intl.NumberFormat(data.locale || "en-CA"); } catch (e) { number = null; }
const closed = new Set();

function isLine(host) {
  return host.getAttribute("data-words") === "line";
}

function closeNotice(ref, host) {
  host.removeAttribute("data-closes");
  const line = host.querySelector(".countdown");
  if (line && isLine(host) && words["status.closed"]) {
    line.className = "countdown countdown-far";
    line.textContent = words["status.closed"];
  } else if (line) line.remove();
  if (!ref) return;
  for (const chip of document.querySelectorAll(".badge[data-notice]")) {
    if (chip.getAttribute("data-notice") !== ref) continue;
    chip.className = "badge badge-closed";
    // A list sorted by closing date shows the time left in place of the chip; the chip comes back now.
    chip.hidden = false;
    if (words["status.closed"]) chip.textContent = words["status.closed"];
  }
  for (const other of document.querySelectorAll("[data-closes][data-notice]")) {
    if (other.getAttribute("data-notice") === ref) closeNotice("", other);
  }
  if (closed.has(ref)) return;
  closed.add(ref);
  for (const count of document.querySelectorAll("[data-soon-count]")) {
    const n = parseInt(count.textContent.replace(/\D/g, ""), 10);
    if (n > 0) count.textContent = number ? number.format(n - 1) : String(n - 1);
  }
}

function tick() {
  const now = Date.now();
  for (const host of document.querySelectorAll("[data-closes]")) {
    const at = Date.parse(host.getAttribute("data-closes") || "");
    if (!Number.isFinite(at)) continue;
    const text = countdownText(at, now, host.getAttribute("data-time") || "", isLine(host) ? lineWords : words);
    if (text === null) {
      closeNotice(host.getAttribute("data-notice") || "", host);
      continue;
    }
    let line = host.querySelector(".countdown");
    if (!line) {
      line = document.createElement("span");
      line.className = "countdown";
      host.appendChild(line);
    }
    if (line.textContent !== text) line.textContent = text;
  }
}

// On the minute, so a notice closing at 14:00 turns at 14:00; a background
// tab's timers may run late, so the page reads again when it is shown.
function schedule() {
  setTimeout(() => { tick(); schedule(); }, 60000 - (Date.now() % 60000) + 50);
}

tick();
schedule();
document.addEventListener("aw:rows", tick);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tick(); });
