// Runs only inside Will's Home Base page (a claude.ai artifact frame).
// Read-only: hands the page a compact study summary and Chrome's most-visited sites. Accepts no writes.
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
  function send() {
    Promise.all([
      chrome.storage.local.get(null),
      chrome.runtime.sendMessage({ type: "topSites" }).catch(function () { return []; }),
    ]).then(function (r) {
      var st = r[0] || {};
      window.postMessage({ homeBase: "data", version: chrome.runtime.getManifest().version,
        quizzes: summary(st), banks: (st.dashboard && st.dashboard.banks) || null, topSites: r[1] || [] }, "*");
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
