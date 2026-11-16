// Shared helpers: bank names -> Block Plan codes, local dates, storage queue.
var OITE = (function () {
  var BANKS = [
    [/hip\s*&\s*knee|adult reconstruction/i, "ar"],
    [/spine/i, "sn"],
    [/tumor|oncology/i, "tu"],
    [/trauma/i, "tr"],
    [/pediatric/i, "pe"],
    [/basic science/i, "bs"],
    [/hand/i, "hw"],
    [/foot/i, "fa"],
    [/shoulder/i, "se"],
    [/sports/i, "sm"],
    [/anatomy/i, "ai"],
    [/miscellaneous/i, "mi"],
    [/oite\s*20(\d\d)/i, function (m) { return "s" + m[1]; }],
    [/oku\s*(\d\d)/i, function (m) { return "ok" + m[1]; }]
  ];
  function code(name) {
    name = String(name || "");
    for (var i = 0; i < BANKS.length; i++) {
      var m = name.match(BANKS[i][0]);
      if (m) return typeof BANKS[i][1] === "function" ? BANKS[i][1](m) : BANKS[i][1];
    }
    return null;
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  // Each ResStudy quiz is its own storage entry ("rsq:<attempt id>"), so a save reads and writes only the quiz
  // you're in. (Up to 1.9.1 every save read and rewrote your whole history while ResStudy was showing the result.)
  var KEY = function (id) { return "rsq:" + id; };
  // One-time move from the old single "quizzes" entry; never overwrites a quiz that's already moved.
  var moved = null;
  function migrate() {
    if (moved) return moved;
    moved = chrome.storage.local.get("quizzes").then(function (st) {
      var old = st.quizzes;
      if (!old || typeof old !== "object") return;
      var ids = Object.keys(old).filter(function (id) { return /^\d+$/.test(id); });
      return chrome.storage.local.get(ids.map(KEY)).then(function (have) {
        var out = {};
        ids.forEach(function (id) { if (!have[KEY(id)]) out[KEY(id)] = old[id]; });
        return chrome.storage.local.set(out).then(function () { return chrome.storage.local.remove("quizzes"); });
      });
    }).catch(function (e) { console.warn("[OITE Tracker] migrate", e); });
    return moved;
  }
  // One read-modify-write at a time. ids: the quiz attempt ids this change may touch (only those are loaded and saved).
  var chain = Promise.resolve();
  function mutate(ids, fn) {
    ids = (ids || []).map(String).filter(function (id, i, a) { return /^\d+$/.test(id) && a.indexOf(id) === i; });
    chain = chain.then(migrate).then(function () {
      return chrome.storage.local.get(["dashboard", "pendingBuild", "debug"].concat(ids.map(KEY))).then(function (st) {
        var s = { quizzes: {}, dashboard: st.dashboard, pendingBuild: st.pendingBuild, debug: st.debug || [] };
        ids.forEach(function (id) { if (st[KEY(id)]) s.quizzes[id] = st[KEY(id)]; });
        var out = fn(s);
        if (out === false) return;
        var w = { dashboard: s.dashboard === undefined ? null : s.dashboard, pendingBuild: s.pendingBuild || null, debug: s.debug };
        Object.keys(s.quizzes).forEach(function (id) {
          if (ids.indexOf(id) >= 0) w[KEY(id)] = s.quizzes[id];   // a quiz that wasn't loaded is never written over
          else console.warn("[OITE Tracker] skipped unloaded quiz", id);
        });
        return chrome.storage.local.set(w);
      });
    }).catch(function (e) { console.warn("[OITE Tracker]", e); });
    return chain;
  }
  // Every attempt id named anywhere in a ResStudy request/response.
  function idsIn() {
    var out = [];
    function walk(o, depth) {
      if (!o || typeof o !== "object" || depth > 7) return;
      if (Array.isArray(o)) { o.forEach(function (v) { walk(v, depth + 1); }); return; }
      if (o.testAttemptId) out.push(String(o.testAttemptId));
      Object.keys(o).forEach(function (k) { walk(o[k], depth + 1); });
    }
    [].slice.call(arguments).forEach(function (o) { walk(o, 0); });
    return out;
  }
  return { code: code, today: today, mutate: mutate, idsIn: idsIn, KEY: KEY };
})();
