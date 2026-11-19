// Runs only inside Will's Home Base page (a claude.ai artifact frame).
// Hands the page a compact study summary, today's plan and Chrome's most-visited sites.
// If today's plan hasn't synced yet, asks the background to pull it (1.9.7), so the page never needs the plan opened by hand.
// The only thing it accepts back: "build today's block number N", using the recipe the Block Plan itself synced (never one from the page).
(function () {
  if (window.__homeBaseBridge) return;
  window.__homeBaseBridge = true;
  var ready = false, timer = null;
  // Questions answered per day, from every source the Block Plan counts:
  //  - ResStudy on every device (the plan's last sync, per quiz per day), topped up by anything logged here since;
  //  - Orthobullets questions logged here (each attempt on its own day; review pages don't count).
  // One entry per source per day: { date, n, c, src }.
  function summary(st) {
    var rem = (st.remote || {}).quizzes || {}, skip = {}, rs = {}, ob = {};
    ((st.remote || {}).aliases || []).forEach(function (id) { skip[id] = 1; });
    var loc = Object.assign({}, st.quizzes || {});
    Object.keys(st).forEach(function (k) { if (k.indexOf("rsq:") === 0) loc[k.slice(4)] = st[k]; });
    var ids = {};
    Object.keys(rem).concat(Object.keys(loc)).forEach(function (id) { if (!skip[id]) ids[id] = 1; });
    Object.keys(ids).forEach(function (id) {
      var days = {}, rd = (rem[id] || {}).days || {}, q = loc[id];
      Object.keys(rd).forEach(function (d) { var a = rd[d] || []; days[d] = [a[1] || 0, a[2] || 0]; });
      if (q && !(q.fromResults && !rem[id])) {
        var ld = {};
        Object.keys(q.qs || {}).forEach(function (k) { var r = q.qs[k]; if (!r || !(r.c === 0 || r.c === 1)) return; var d = r.d || q.date || ""; var x = ld[d] || (ld[d] = [0, 0]); x[0]++; x[1] += r.c; });
        Object.keys(ld).forEach(function (d) { if (!days[d] || ld[d][0] > days[d][0]) days[d] = ld[d]; });
      }
      Object.keys(days).forEach(function (d) { if (!d) return; var x = rs[d] || (rs[d] = [0, 0]); x[0] += days[d][0]; x[1] += days[d][1]; });
    });
    var all = st.obQuestions || {};
    Object.keys(all).forEach(function (qid) {
      var q = all[qid] || {}, att = Array.isArray(q.attempts) && q.attempts.length ? q.attempts
        : (q.result && !q.review ? [{ d: q.date, res: q.result }] : []);
      att.forEach(function (x) { if (!x || !x.d || !(x.res === "correct" || x.res === "incorrect")) return; var y = ob[x.d] || (ob[x.d] = [0, 0]); y[0]++; if (x.res === "correct") y[1]++; });
    });
    var out = [];
    Object.keys(rs).forEach(function (d) { if (rs[d][0]) out.push({ date: d, n: rs[d][0], c: rs[d][1], src: "resstudy" }); });
    Object.keys(ob).forEach(function (d) { if (ob[d][0]) out.push({ date: d, n: ob[d][0], c: ob[d][1], src: "orthobullets" }); });
    return out;
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
      blocks: (td.blocks || []).map(function (b) { var sp = b.spec || null;
        return { name: String(b.name || ""), full: String(b.full || b.name || ""), recipe: String(b.recipe || ""), n: b.n, left: b.left,
          src: sp ? sp.src : null, buildable: !!(sp && (sp.src === "orthobullets" || (sp.src === "resstudy" && !sp.bank))) }; }), syncedAt: rem.at || null };
  }
  function send() {
    Promise.all([
      chrome.storage.local.get(null),
      chrome.runtime.sendMessage({ type: "topSites" }).catch(function () { return []; }),
    ]).then(function (r) {
      var st = r[0] || {}, pl = plan(st);
      // Today's plan not synced yet: have the extension open the Block Plan in a background tab for a moment (at most every 15 min).
      if (pl.stale) { try { chrome.runtime.sendMessage({ type: "pullIfStale", minGapMin: 15 }).catch(function () {}); } catch (e) {} }
      window.postMessage({ homeBase: "data", version: chrome.runtime.getManifest().version,
        quizzes: summary(st), banks: (st.dashboard && st.dashboard.banks) || null, topSites: r[1] || [], plan: pl }, "*");
    }).catch(function () {});
  }
  function reply(reqId, status, msg) { window.postMessage({ homeBase: "build", reqId: reqId, status: status, msg: msg || "" }, "*"); }
  window.addEventListener("message", function (e) {
    if (e.source !== window || !e.data) return;
    var m = e.data;
    if (m.homeBase === "hello") { ready = true; send(); return; }
    if (m.homeBase === "build" && m.reqId && typeof m.idx === "number") {
      var reqId = String(m.reqId).slice(0, 40);
      chrome.storage.local.get("remote").then(function (st) {
        var td = (st.remote || {}).today, b = td && td.date === day() && (td.blocks || [])[m.idx];
        if (!b || !b.spec) { reply(reqId, "error", "That block isn't in today's synced plan. Open the tracker once, then try again."); return; }
        return chrome.runtime.sendMessage({ type: "build", reqId: reqId, spec: b.spec }).then(function (r) {
          if (!r || !r.ok) reply(reqId, "error", (r && r.error) || "The extension couldn't open the test builder.");
          else reply(reqId, "opened", "");
        });
      }).catch(function () { reply(reqId, "error", "The extension couldn't open the test builder. Reload this page and try again."); });
    }
  });
  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== "buildStatus" || !msg.reqId) return;
    reply(msg.reqId, msg.status, msg.msg || "");
  });
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (!ready || area !== "local") return;
    clearTimeout(timer); timer = setTimeout(send, 600);
  });
})();
