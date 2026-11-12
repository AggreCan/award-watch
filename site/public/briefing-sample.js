/* The weekly briefing's public sample (src/account/briefing_pages.tsx): the
   inbox tabs switch the reading pane in place, and each message frame takes
   its message's height, so the page scrolls as one. Without this script the
   tabs are links that reload the page with ?scheme= and each frame scrolls
   inside a fixed height. The frames hold the site's own documents (same
   origin, sandboxed, with no script of their own), so this page can read
   their height. Nothing is stored or sent. */
(function () {
  var box = document.querySelector(".inbox");
  if (!box) return;
  var root = document.documentElement;

  // The site's theme as theme.js decides it: a saved choice, else the system setting.
  function siteScheme() {
    var set = root.getAttribute("data-theme");
    if (set === "dark" || set === "light") return set;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function frameOf(scheme) {
    return box.querySelector("iframe.inbox-" + scheme);
  }

  // The frame takes its message's height. A frame not shown, or not loaded
  // yet (its document is still the empty one), waits for its turn.
  function fit(frame) {
    if (!frame || frame.offsetParent === null) return;
    var doc = null;
    try { doc = frame.contentDocument; } catch (e) { doc = null; }
    if (!doc || !doc.body || doc.URL === "about:blank") return;
    var height = Math.ceil(doc.body.getBoundingClientRect().height);
    if (height > 0) frame.style.height = height + "px";
  }

  function show(scheme) {
    box.setAttribute("data-scheme", scheme);
    var tabs = box.querySelectorAll("a[data-scheme]");
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute("data-scheme") === scheme) tabs[i].setAttribute("aria-current", "page");
      else tabs[i].removeAttribute("aria-current");
    }
    fit(frameOf(scheme));
  }

  // Without ?scheme= the stylesheet shows the frame of the site's theme; the
  // page starts there and then stays on the reader's choice.
  var start = box.getAttribute("data-scheme");
  show(start === "light" || start === "dark" ? start : siteScheme());

  var frames = box.querySelectorAll("iframe.inbox-frame");
  for (var i = 0; i < frames.length; i++) {
    (function (frame) {
      frame.addEventListener("load", function () { fit(frame); });
      fit(frame);
    })(frames[i]);
  }

  box.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[data-scheme]") : null;
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    show(a.getAttribute("data-scheme"));
    try { history.replaceState(history.state, "", a.href); } catch (err) {}
  });

  // A new width reflows the message, so the shown frame is measured again.
  var pending = false;
  window.addEventListener("resize", function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      fit(frameOf(box.getAttribute("data-scheme")));
    });
  });
})();
