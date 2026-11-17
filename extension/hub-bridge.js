// Runs only inside Will's Home Base page (a claude.ai artifact frame).
// Read-only: hands the page a compact study summary, today's plan and Chrome's most-visited sites. Accepts no writes.
(function () {
  if (window.__homeBaseBridge) return;
  window.__homeBaseBridge = true;
  var ready = false, timer = null;
  function summary(st) {
    var quizzes = Object.assign({}, st.quizzes || {});
    Object.keys(st).forEach(function (k) { if (k.indexOf("rsq:") === 0) quizzes[k.slice(4)] = st[k]; });
    return Object.keys(quizzes).map(function (id) {
      var q = quizzes[id] || {}, n = 0, c = 0;
      Object.keys(q.qs || {}).forEach(function (k) { var x = q.qs[k]; if (x && (x.c === 0 || x.c === 1)) { n++; c += x.c; } });
      return { date: q.date || null, n: n, c: c, cat: q.cat || null };
    }).filter(function (q) { return q.n; });
  }
  function day() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  // Today's blocks as the Block Plan last synced them, less anything answered on this computer since (same sum the popup shows).
  function plan(st) {
    var rem = st.remote || {}, td = rem.today, t = day();
    if (!td || td.date !== t) return { date: t, stale: true, syncedAt: rem.at || null };
    var remToday = 0, local = 0, skip = {};
    Object.keys(rem.quizzes || {}).forEach(function (id) { var a = ((rem.quizzes[id] || {}).days || {})[t]; if (a) remToday += a[0]; });
    (rem.aliases || []).forEach(function (id) { skip[id] = 1; });
    var loc = Object.assign({}, st.quizzes || {});
    Object.keys(st).forEach(function (k) { if (k.indexOf("rsq:") === 0) loc[k.slice(4)] = st[k]; });
    Object.keys(loc).forEach(function (id) {
      var q = loc[id] || {}; if (skip[id] || (q.fromResults && !(rem.quizzes || {})[id])) return;
      Object.keys(q.qs || {}).forEach(function (k) { var r = q.qs[k]; if (r && r.a && (r.d || q.date || "") === t) local++; });
    });
    return { date: t, left: Math.max(0, (td.left || 0) - Math.max(0, local - remToday)), plannedLeft: td.left || 0,
      blocks: (td.blocks || []).map(function (b) { return { name: String(b.name || ""), left: b.left }; }), syncedAt: rem.at || null };
  }
  function send() {
    Promise.all([
      chrome.storage.local.get(null),
      chrome.runtime.sendMessage({ type: "topSites" }).catch(function () { return []; }),
    ]).then(function (r) {
      var st = r[0] || {};
      window.postMessage({ homeBase: "data", version: chrome.runtime.getManifest().version,
        quizzes: summary(st), banks: (st.dashboard && st.dashboard.banks) || null, topSites: r[1] || [], plan: plan(st) }, "*");
    }).catch(function () {});
  }
  window.addEventListener("message", function (e) {
    if (e.source !== window || !e.data || e.data.homeBase !== "hello") return;
    ready = true; send();
  });
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (!ready || area !== "local") return;
    clearTimeout(timer); timer = setTimeout(send, 600);
  });
})();
