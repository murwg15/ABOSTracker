// ResStudy dark mode (OITE Tracker 1.9.1+).
// Runs at document_start so the page never flashes white. The setting lives in
// learn.aaos.org's own localStorage ("oiteDarkMode": auto | dark | light), so it is
// read synchronously and shared by every ResStudy tab on this computer.
// Auto = dark from 20 min before sunset until 20 min after sunrise.
(function () {
  if (window.top !== window || window.__oiteDark) return;
  // The standalone "ResStudy Dark Mode" extension does the same job; if it already ran
  // on this page, let it (both share the setting, so nothing changes for the user).
  if (document.documentElement.hasAttribute("data-oite-mode")) return;
  window.__oiteDark = true;

  var KEY = "oiteDarkMode";
  var ORDER = ["auto", "dark", "light"];
  var root = document.documentElement;
  var btn = null, toastEl = null, toastTimer = null;

  function getMode() {
    try { var m = localStorage.getItem(KEY); return m === "dark" || m === "light" ? m : "auto"; }
    catch (e) { return "auto"; }
  }
  function setMode(m) {
    try { localStorage.setItem(KEY, m); } catch (e) {}
    apply();
  }

  // Sunrise and sunset for today's local date (NOAA approximation, within a few minutes).
  // Location: latitude 36 N (Memphis and Durham are both ~35-36) and the centre longitude
  // of this computer's time zone, so it follows the computer's clock if you move.
  function sunTimes(now) {
    var rad = Math.PI / 180, y = now.getFullYear(), mo = now.getMonth(), d = now.getDate();
    var std = Math.max(new Date(y, 0, 1).getTimezoneOffset(), new Date(y, 6, 1).getTimezoneOffset());
    var lon = -std / 4, lat = 36;
    var n = Math.floor((Date.UTC(y, mo, d) - Date.UTC(y, 0, 0)) / 864e5);
    var B = 2 * Math.PI / 365 * (n - 81);
    var eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
    var decl = -23.44 * Math.cos(2 * Math.PI / 365 * (n + 10)) * rad;
    var c = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
    var w = Math.acos(Math.max(-1, Math.min(1, c))) / rad;
    var noon = 720 - 4 * lon - eot;                       // minutes after UTC midnight of today's date
    var base = Date.UTC(y, mo, d);
    return { rise: new Date(base + (noon - 4 * w) * 6e4), set: new Date(base + (noon + 4 * w) * 6e4) };
  }
  function darkWindow(now) {
    var s = sunTimes(now), pad = 20 * 6e4;
    return { start: new Date(s.set.getTime() - pad), end: new Date(s.rise.getTime() + pad) };
  }
  function isNight(now) {
    var w = darkWindow(now), t = now.getTime();
    return t >= w.start.getTime() || t < w.end.getTime();
  }
  function hm(dt) {
    return dt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?([AP])M/i, function (_, a) { return " " + a.toLowerCase() + "m"; });
  }

  function apply() {
    var m = getMode();
    var dark = m === "dark" || (m === "auto" && isNight(new Date()));
    root.classList.toggle("oite-dark", dark);
    root.setAttribute("data-oite-mode", m);
    paintButton();
    if (dark) scanSoon();
  }

  // ---------- the little toggle (top-right corner) ----------
  var ICONS = {
    auto: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
    dark: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></g></svg>'
  };
  function describe(m) {
    if (m === "dark") return "Dark mode: always on";
    if (m === "light") return "Dark mode: off";
    var w = darkWindow(new Date());
    return "Dark mode: auto, " + hm(w.start) + " to " + hm(w.end);
  }
  function paintButton() {
    if (!btn) return;
    var m = getMode(), d = describe(m);
    if (btn.getAttribute("data-mode") !== m) { btn.innerHTML = ICONS[m]; btn.setAttribute("data-mode", m); }
    if (btn.getAttribute("aria-label") !== d) {
      btn.title = d + "\nClick to change (Option/Alt + Shift + D)";
      btn.setAttribute("aria-label", d);
    }
  }
  function toast(text) {
    if (!document.body) return;
    if (!toastEl || !toastEl.isConnected) {
      toastEl = document.createElement("div");
      toastEl.id = "oite-dark-toast";
      toastEl.className = "oite-keep";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2200);
  }
  function cycle() {
    var m = ORDER[(ORDER.indexOf(getMode()) + 1) % ORDER.length];
    setMode(m);
    toast(describe(m));
  }
  function mountButton() {
    if (btn || !document.body || document.getElementById("oite-dark-btn")) return;
    btn = document.createElement("button");
    btn.id = "oite-dark-btn";
    btn.type = "button";
    btn.className = "oite-keep";
    btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); cycle(); });
    document.body.appendChild(btn);
    paintButton();
  }

  // ---------- what keeps its own colours ----------
  // Inverting works for the white pages and dark text, but a coloured fill with white text
  // (buttons, the selected wizard option, the "Question 16 of 50" chip, a red header, a dark
  // picture viewer) would come out as a mid-tone blob with black text. So:
  //   .oite-band  wide dark bar at the top (the red header): own colours, dimmed, logo darkened
  //   .oite-own   light text on a coloured/dark fill, or a full-screen dark overlay: own colours, dimmed
  //   [data-oite-icon]  pictures no bigger than 40 px: flip with the page like any icon
  var SKIP = /^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE|SVG|IMG|VIDEO|CANVAS|IFRAME|EMBED|OBJECT|BR|HR)$/i;
  function rgba(c) {
    var m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(c || "");
    return m ? { l: (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255, a: m[4] === undefined ? 1 : +m[4] } : null;
  }
  function classify(el, cs, vw, vh) {
    var bg = rgba(cs.backgroundColor);
    if (!bg || bg.a === 0 || bg.l >= 0.7) return null;
    if (cs.position === "fixed" && bg.l < 0.3) {
      var f = el.getBoundingClientRect();
      if (f.width >= vw * 0.9 && f.height >= vh * 0.9) return "oite-own";        // dimming overlay
    }
    if (bg.a < 0.5) return null;
    if (bg.l < 0.35) {
      var r = el.getBoundingClientRect();
      if (r.width >= vw * 0.8 && r.height >= 40 && r.height <= 420 && r.top + window.scrollY < 200 &&
          !el.closest(".modal, [role=dialog]")) return "oite-band";
    }
    var fg = rgba(cs.color);
    return fg && fg.l > 0.75 ? "oite-own" : null;
  }
  function setMark(el, want) {
    if (want !== "oite-band" && el.classList.contains("oite-band")) el.classList.remove("oite-band");
    if (want !== "oite-own" && el.classList.contains("oite-own")) el.classList.remove("oite-own");
    if (want && !el.classList.contains(want)) el.classList.add(want);
  }
  function markImg(img) {
    var w = img.clientWidth || img.naturalWidth, h = img.clientHeight || img.naturalHeight;
    var icon = !!(w && h && w <= 40 && h <= 40);
    if (icon !== img.hasAttribute("data-oite-icon")) icon ? img.setAttribute("data-oite-icon", "") : img.removeAttribute("data-oite-icon");
    if (!img.complete && !img.__oiteWait) { img.__oiteWait = true; img.addEventListener("load", function () { markImg(img); }, { once: true }); }
  }
  function scanAll() {
    if (!document.body || !root.classList.contains("oite-dark")) return;
    var vw = window.innerWidth, vh = window.innerHeight;
    [].forEach.call(document.body.getElementsByTagName("img"), markImg);
    var tw = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (el) {
        if (SKIP.test(el.tagName) || el.id === "oite-dark-btn" || el.id === "oite-dark-toast") return NodeFilter.FILTER_REJECT;
        var cs = getComputedStyle(el);
        if (cs.display === "none") { setMark(el, null); return NodeFilter.FILTER_REJECT; }
        var want = classify(el, cs, vw, vh);
        setMark(el, want);
        if (!want) return NodeFilter.FILTER_ACCEPT;
        // a marked box shows its own colours; nothing inside it may be marked again
        [].forEach.call(el.querySelectorAll(".oite-band, .oite-own"), function (d) { setMark(d, null); });
        return NodeFilter.FILTER_REJECT;
      }
    });
    while (tw.nextNode()) {}
  }
  var scanTimer = null;
  function scanSoon() { if (!scanTimer) scanTimer = setTimeout(function () { scanTimer = null; scanAll(); }, 120); }
  function onlyOurMarks(r) {
    if (r.type !== "attributes" || r.attributeName !== "class") return r.type === "attributes" && r.attributeName === "data-oite-icon";
    var strip = function (v) { return (v || "").replace(/\boite-(band|own)\b/g, "").replace(/\s+/g, " ").trim(); };
    return strip(r.oldValue) === strip(r.target.getAttribute("class"));
  }

  apply();
  setInterval(apply, 60000);                     // flips on its own at dusk and dawn
  window.addEventListener("storage", function (e) { if (e.key === KEY) apply(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) apply(); });
  document.addEventListener("keydown", function (e) {
    if (e.code !== "KeyD" || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    cycle();
  }, true);

  function ready() {
    mountButton();
    scanAll();
    window.addEventListener("load", scanAll);
    window.addEventListener("resize", scanSoon);
    new MutationObserver(function (list) {
      if (btn && !btn.isConnected) { btn = null; mountButton(); }
      for (var i = 0; i < list.length; i++) if (!onlyOurMarks(list[i])) { scanSoon(); return; }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["class", "style"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
