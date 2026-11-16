// Runs inside claude.ai artifact frames. Only talks to a page that says
// hello as the OITE Block Plan; hands it everything logged from ResStudy.
(function () {
  if (window.__oiteBridge) return;
  window.__oiteBridge = true;
  var ready = false, timer = null;
  function send() {
    chrome.storage.local.get(null).then(function (st) {
      var quizzes = Object.assign({}, st.quizzes || {});   // old single entry, until it has been moved
      Object.keys(st).forEach(function (k) { if (k.indexOf("rsq:") === 0) quizzes[k.slice(4)] = st[k]; });
      window.postMessage({ oiteTracker: "data", version: chrome.runtime.getManifest().version, caps: { fig: 1, ob: 1, build: 1, resume: 1 }, obQuestions: st.obQuestions || {}, obTestLinks: st.obTestLinks || {},
                           quizzes: quizzes, dashboard: st.dashboard || null }, "*");
    }).catch(function () {});
  }
  window.addEventListener("message", function (e) {
    if (e.source !== window || !e.data) return;
    var m = e.data;
    if (m.oitePlan === "hello") { ready = true; send(); }
    if (m.oitePlan === "tag" && m.id) {
      var key = "rsq:" + m.id;
      chrome.storage.local.get([key, "quizzes"]).then(function (st) {
        var q = st[key];
        if (q) { q.cat = m.cat || null; q.catManual = true; q.updatedAt = Date.now(); var w = {}; w[key] = q; return chrome.storage.local.set(w); }
        q = st.quizzes && st.quizzes[m.id];
        if (!q) return;
        q.cat = m.cat || null; q.catManual = true; q.updatedAt = Date.now();
        return chrome.storage.local.set({ quizzes: st.quizzes });
      });
    }
    if (m.oitePlan === "state" && m.quizzes && typeof m.quizzes === "object") {
      // compact per-quiz totals from the plan's shared database (all devices)
      chrome.storage.local.set({ remote: { at: Date.now(), quizzes: m.quizzes, today: m.today || null, aliases: m.aliases || [] } });
    }
    // The plan asks for one question figure at a time; the background worker fetches it
    // (the plan page itself is not allowed to load anything from outside claude.ai).
    if (m.oitePlan === "figReq" && m.id && typeof m.url === "string") {
      var reply = function (res) {
        window.postMessage({ oiteTracker: "fig", id: m.id, ok: !!(res && res.ok), data: (res && res.data) || null,
                             error: (res && res.error) || null }, "*");
      };
      try { chrome.runtime.sendMessage({ type: "fig", url: m.url }).then(reply, function () { reply({ ok: false, error: "unreachable" }); }); }
      catch (err) { reply({ ok: false, error: "unreachable" }); }
    }
    // Tap on a block's box: open that block's test builder and set it up (build.js does the clicking).
    if (m.oitePlan === "build" && m.reqId && m.spec && typeof m.spec === "object") {
      var fail = function (msg) { window.postMessage({ oiteTracker: "build", reqId: m.reqId, status: "error", msg: msg }, "*"); };
      try {
        chrome.runtime.sendMessage({ type: "build", reqId: String(m.reqId), spec: m.spec }).then(function (r) {
          if (!r || !r.ok) fail((r && r.error) || "The extension couldn't open the test builder.");
        }, function () { fail("The extension couldn't open the test builder."); });
      } catch (err) { fail("The extension couldn't open the test builder. Reload this page and try again."); }
    }
    if (m.oitePlan === "synced") {
      chrome.storage.local.set({ lastSync: Date.now() });
    }
  });
  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== "buildStatus" || !msg.reqId) return;
    window.postMessage({ oiteTracker: "build", reqId: msg.reqId, status: msg.status, msg: msg.msg || "", n: msg.n || null, matched: msg.matched == null ? null : msg.matched }, "*");
  });
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (!ready || area !== "local" || !(ch.quizzes || ch.dashboard || ch.obQuestions || ch.obTestLinks || Object.keys(ch).some(function (k) { return k.indexOf("rsq:") === 0; }))) return;
    clearTimeout(timer); timer = setTimeout(send, 400);
  });
})();
