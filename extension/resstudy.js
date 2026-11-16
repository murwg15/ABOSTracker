// Isolated-world script on learn.aaos.org. Turns ResStudy traffic into a
// per-quiz log in chrome.storage.local, remembers what you picked on the
// Build a Quiz screen, and snapshots the dashboard's per-bank counts.
(function () {
  if (window.__oiteRelay) return;
  window.__oiteRelay = true;
  var KNOWN = /next-page|previous-page|prev-page|answer-remediation|goto|jump|question-attempt|question-notes/;

  function text(html) {
    var d = new DOMParser().parseFromString("<div>" + (html || "") + "</div>", "text/html");
    return (d.body.textContent || "").replace(/\s+/g, " ").trim();
  }
  function hasSel(a) { return Array.isArray(a) ? a.length > 0 : !!(a && Object.keys(a).length); }
  // Addresses of a question's figures (images only). The pictures themselves are fetched later, by the plan.
  function figs(medias) {
    var out = [];
    (medias || []).forEach(function (m) {
      var u = m && m.url;
      if (m && m.type === "image" && typeof u === "string" && /^https:\/\//.test(u) && u.length < 400 && out.indexOf(u) < 0) out.push(u);
    });
    return out.slice(0, 8);
  }

  function classify(q) {
    var c = OITE.code(q.name);
    if (c) return c;
    var b = q.build;
    if (!b) return null;
    var filt = (b.filters || []).join(" ");
    if (/incorrect/i.test(filt) && !/unanswered/i.test(filt)) return "ix";
    if (b.random) return "rn";
    var codes = (b.topics || []).map(OITE.code).filter(Boolean);
    if (codes.length === 1) return codes[0];
    if (codes.length > 1) return "multi";
    return null;
  }

  function quizFor(st, id, name, total, firstOrder) {
    var q = st.quizzes[id];
    if (!q) {
      q = st.quizzes[id] = { id: String(id), name: name || "", startedAt: new Date().toISOString(),
                             date: OITE.today(), total: total || 0, qs: {} };
      var pb = st.pendingBuild;
      // Only a brand-new quiz (opening on question 1) inherits the Build a Quiz
      // choices; a resumed quiz would otherwise pick up whatever was last clicked.
      var fresh = !firstOrder || firstOrder <= 1;
      if (pb && fresh && Date.now() - pb.ts < 3 * 3600e3) { q.build = pb; q.mode = pb.mode || ""; }
      else if (!fresh) q.resumed = true;
      st.pendingBuild = null;
    }
    if (name && !q.name) q.name = name;
    if (total) q.total = total;
    q.cat = q.catManual ? q.cat : classify(q);
    return q;
  }
  function rec(q, qa) { return q.qs[qa] || (q.qs[qa] = {}); }
  function touch(q) { q.updatedAt = Date.now(); }

  function onTraffic(m) {
    var url = m.url, req = m.req, res = m.res;
    OITE.mutate(OITE.idsIn(res, req), function (st) {
      var changed = false;
      // Question pages (first load, next/previous) carry the quiz + question metadata.
      if (res && res.testAttemptId && Array.isArray(res.questions)) {
        var first = res.questions[0] && res.questions[0].displayOrder;
        var q = quizFor(st, res.testAttemptId, res.name, res.totalQuestions, first);
        res.questions.forEach(function (x) {
          if (!x || !x.questionAttemptId) return;
          var r = rec(q, x.questionAttemptId);
          if (x.displayNumber) r.n = String(x.displayNumber);
          if (x.stem) { var st1 = text(x.stem).slice(0, 1200); if (!r.s || st1.length > r.s.length) r.s = st1; }
          if (Array.isArray(x.medias) && x.medias.length) { r.img = x.medias.length; var fu = figs(x.medias); if (fu.length) r.fu = fu; }
          if (x.displayOrder) r.o = x.displayOrder;
          // answer choices, kept until the question is graded
          if (Array.isArray(x.answers) && r.c === undefined) {
            r.ans = {};
            x.answers.forEach(function (a) { if (a && a.id) r.ans[a.id] = text(a.text).slice(0, 160); });
          }
          if (hasSel(x.selectedAnswers) && !r.a) { r.a = 1; r.d = r.d || OITE.today(); }
        });
        touch(q); changed = true;
      }
      // Moving between questions posts the answers you picked (this is how
      // Simulated Exam answers get counted before the exam is submitted).
      if (req && req.testAttemptId && Array.isArray(req.questions)) {
        var q2 = quizFor(st, req.testAttemptId);
        req.questions.forEach(function (x) {
          if (x && x.questionAttemptId && hasSel(x.selectedAnswers)) {
            var r = rec(q2, x.questionAttemptId);
            if (!r.a) { r.a = 1; r.d = r.d || OITE.today(); }
            if (Array.isArray(x.selectedAnswers)) r.sel = x.selectedAnswers.slice(0, 4);
          }
        });
        if (req.timeTaken && req.questions.length === 1 && req.questions[0] && req.questions[0].questionAttemptId) {
          var rt = rec(q2, req.questions[0].questionAttemptId);
          rt.tp = Math.round((rt.tp || 0) + req.timeTaken / 1000);
        }
        touch(q2); changed = true;
      }
      // Study Mode: submitting an answer returns right/wrong + peer stats.
      if (/answer-remediation/.test(url) && req && req.questionAttemptId && res) {
        var q3 = quizFor(st, req.testAttemptId);
        var r3 = rec(q3, req.questionAttemptId);
        r3.a = 1; r3.d = r3.d || OITE.today();
        if (typeof res.correctResponse === "boolean") r3.c = res.correctResponse ? 1 : 0;
        if (typeof res.averagePeerPercent === "number") r3.p = res.averagePeerPercent;
        if (req.questionResponseTime) r3.t = Math.round(req.questionResponseTime / 1000);
        var ans = r3.ans || {};
        var ok = (res.correctAnswerIds || []).map(function (id) { return ans[id]; }).filter(Boolean).join(" / ");
        if (ok) r3.ok = ok.slice(0, 200);
        var all = Object.keys(ans).map(function (id) { return ans[id]; }).filter(Boolean);
        if (all.length) r3.ch = all;               // every answer's choices, right or wrong
        if (r3.c === 0) {
          var pick = (req.selectedAnswers || []).map(function (id) { return ans[id]; }).filter(Boolean).join(" / ");
          if (pick) r3.pick = pick.slice(0, 200);
          if (res.feedback) r3.f = text(res.feedback).slice(0, 1500);
        }
        // Tumor questions with figures keep a short explanation even when answered right:
        // the plan uses it to file histology slides under the right diagnosis.
        else if (res.feedback && r3.img && q3.cat === "tu") r3.f = text(res.feedback).slice(0, 700);
        delete r3.ans;
        touch(q3); changed = true;
      }
      // Anything else that reports per-question correctness (e.g. a submitted
      // Simulated Exam's results) — picked up generically.
      if (res && !/answer-remediation|next-page|previous-page|prev-page/.test(url)) {
        var hits = 0;
        (function walk(o, taid, depth) {
          if (!o || typeof o !== "object" || depth > 6) return;
          if (Array.isArray(o)) { o.forEach(function (v) { walk(v, taid, depth + 1); }); return; }
          var t = o.testAttemptId || taid;
          var cr = typeof o.correctResponse === "boolean" ? o.correctResponse
                 : typeof o.correct === "boolean" ? o.correct : null;
          if (o.questionAttemptId && cr !== null && t) {
            var qq = quizFor(st, t);
            var rr = rec(qq, o.questionAttemptId);
            rr.c = cr ? 1 : 0; rr.a = 1; rr.d = rr.d || OITE.today();
            if (rr.ans && Array.isArray(o.correctAnswerIds)) {
              var okt = o.correctAnswerIds.map(function (id) { return rr.ans[id]; }).filter(Boolean).join(" / ");
              if (okt) rr.ok = okt.slice(0, 200);
              if (!cr && rr.sel) {
                var pk = rr.sel.map(function (id) { return rr.ans[id]; }).filter(Boolean).join(" / ");
                if (pk) rr.pick = pk.slice(0, 200);
              }
            }
            if (!cr && (o.feedback || o.remediation) && typeof (o.feedback || o.remediation) === "string")
              rr.f = text(o.feedback || o.remediation).slice(0, 1500);
            touch(qq); hits++;
          }
          Object.keys(o).forEach(function (k) { walk(o[k], t, depth + 1); });
        })(res, null, 0);
        if (hits) changed = true;
      }
      // Keep a short trail of endpoints we don't know yet, for troubleshooting.
      if (!KNOWN.test(url)) {
        st.debug.push({ at: new Date().toISOString(), url: url,
                        req: JSON.stringify(req || null).slice(0, 1500),
                        res: JSON.stringify(res || null).slice(0, 4000) });
        st.debug = st.debug.slice(-15);
        changed = true;
      }
      return changed;
    });
  }


  // Start of a study session: pull in what your other devices logged (at most every 30 min).
  if (window.top === window) { try { chrome.runtime.sendMessage({ type: "pull", minGapMin: 30 }); } catch (e) {} }

  function onResults(m) {
    var need = [];
    OITE.mutate([m.testAttemptId], function (st) {
      var isNew = !st.quizzes[m.testAttemptId];
      var q = quizFor(st, m.testAttemptId, m.name, (m.results || []).length, 99);   // 99: never inherit Build a Quiz choices
      // First seen on a Results page: usually ResStudy's re-filed copy of a quiz already logged.
      // The plan matches it to the original, so it is flagged and never counted on its own here.
      if (isNew) q.fromResults = true;
      var day = q.date || OITE.today();
      (m.results || []).forEach(function (x) {
        if (!x || !x.questionAttemptId) return;
        var r = rec(q, x.questionAttemptId);
        if (x.index) r.o = x.index;
        if (x.result === "CORRECT" || x.result === "INCORRECT") {
          r.a = 1; r.c = x.result === "CORRECT" ? 1 : 0; r.d = r.d || day;
        }
        if (r.a && (!r.s || !r.ok || !r.ch || (r.c === 0 && !r.f) || (r.img && !r.fu))) need.push(x.questionAttemptId);
      });
      touch(q);
    }).then(function () {
      if (need.length) window.postMessage({ __oite: "need", testAttemptId: m.testAttemptId, ids: need }, location.origin);
    });
  }
  function onReview(m) {
    var Q = m.data && m.data.question, R = (m.data && m.data.remediation) || {};
    if (!Q || !Q.questionAttemptId) return;
    OITE.mutate([m.testAttemptId], function (st) {
      var q = quizFor(st, m.testAttemptId);
      var r = rec(q, Q.questionAttemptId);
      var byId = {};
      (Q.answers || []).forEach(function (a) { if (a && a.id) byId[a.id] = text(a.text).slice(0, 160); });
      var okIds = (R.correctAnswerIds && R.correctAnswerIds.length) ? R.correctAnswerIds
                : (Q.answers || []).filter(function (a) { return a.correctResponse; }).map(function (a) { return a.id; });
      if (Q.displayNumber) r.n = String(Q.displayNumber);
      if (Q.stem) { var st2 = text(Q.stem).slice(0, 1200); if (!r.s || st2.length > r.s.length) r.s = st2; }
      if (Array.isArray(Q.medias) && Q.medias.length) { r.img = Q.medias.length; var fu = figs(Q.medias); if (fu.length) r.fu = fu; }
      var ok = okIds.map(function (id) { return byId[id]; }).filter(Boolean).join(" / ");
      if (ok) r.ok = ok.slice(0, 200);
      var chs = (Q.answers || []).slice().sort(function (a, b) { return (a.displayOrder || 0) - (b.displayOrder || 0); })
        .map(function (a) { return text(a.text).slice(0, 160); }).filter(Boolean);
      if (chs.length) r.ch = chs;                // every answer's choices, right or wrong
      if (r.c === 0) {
        var pick = (Q.selectedAnswers || []).map(function (id) { return byId[id]; }).filter(Boolean).join(" / ");
        if (pick) r.pick = pick.slice(0, 200);
        if (R.feedback) r.f = text(R.feedback).slice(0, 1500);
        }
      else if (R.feedback && r.img && q.cat === "tu" && !r.f) r.f = text(R.feedback).slice(0, 700);
      // review-screen time includes reading the explanation, so it is kept apart from answer time
      if (Q.timeTakenInMillis && !r.t) r.tt = Math.round(Q.timeTakenInMillis / 1000);
      if (typeof R.averagePeerPercent === "number" && R.averagePeerPercent > 0 && r.p === undefined) r.p = R.averagePeerPercent;
      delete r.ans;
      touch(q);
    });
  }

  window.addEventListener("message", function (e) {
    if (e.source !== window || !e.data) return;
    if (e.data.__oite === "xhr") onTraffic(e.data);
    else if (e.data.__oite === "results") onResults(e.data);
    else if (e.data.__oite === "review") onReview(e.data);
  });

  // ---------- Build a Quiz: remember the choices ----------
  function labelOf(inp) {
    var l = inp.id && document.querySelector('label[for="' + CSS.escape(inp.id) + '"]');
    l = l || inp.closest("label") || inp.parentElement;
    var t = (l && (l.innerText || l.textContent) || "").trim().split("\n")[0].trim();
    return t.slice(0, 80);
  }
  var lastSnap = null;
  function snapBuild() {
    // Only on Build a Quiz itself; a question's answer choices are radios too, and this used to save on every click there.
    if (!document.querySelector('input[type=radio][name=mode], #randomQs, #unanswered')) return;
    var inputs = [].slice.call(document.querySelectorAll('input[type=checkbox], input[type=radio]'));
    if (!inputs.length) return;
    var topics = [], topicSeen = false, random = null, mode = null, modeSeen = false, filters = [], filtSeen = false;
    inputs.forEach(function (inp) {
      var t = labelOf(inp);
      if (!t) return;
      if (/^random/i.test(t)) { random = inp.checked; topicSeen = true; return; }
      if (/study mode|simulated exam/i.test(t)) { modeSeen = true; if (inp.checked) mode = /simulated/i.test(t) ? "sim" : "study"; return; }
      if (OITE.code(t) && /\(\d+\)/.test(t)) { topicSeen = true; if (inp.checked) topics.push(t.replace(/\s*\(\d+\)\s*$/, "")); return; }
      filtSeen = true; if (inp.checked) filters.push(t);
    });
    // Styled radios sometimes hide the input; fall back to the highlighted card.
    if (!modeSeen && /How would you like to take the quiz/i.test(document.body.innerText || "")) {
      modeSeen = true;
      var sel = document.querySelector(".active, .selected, [class*=selected]");
      if (sel) mode = /simulated/i.test(sel.innerText) ? "sim" : "study";
    }
    if (!topicSeen && !modeSeen && !filtSeen) return;
    var snap = JSON.stringify([modeSeen && mode, topicSeen && topics, topicSeen && random, filtSeen && filters]);
    if (snap === lastSnap) return;
    lastSnap = snap;
    OITE.mutate([], function (st) {
      var b = st.pendingBuild || { topics: [], filters: [] };
      if (modeSeen && mode) b.mode = mode;
      if (topicSeen) { b.topics = topics; b.random = !!random; }
      if (filtSeen) b.filters = filters;
      b.ts = Date.now();
      st.pendingBuild = b;
    });
  }
  var buildTimer = null;
  function queueSnap() { clearTimeout(buildTimer); buildTimer = setTimeout(snapBuild, 120); }
  document.addEventListener("click", queueSnap, true);
  document.addEventListener("change", queueSnap, true);

  // ---------- Dashboard: per-bank answered counts ----------
  function parseDashboard() {
    var main = document.querySelector("main") || document.body;
    if (!main) return;
    var lines = (main.innerText || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    var banks = {}, n = 0;
    for (var i = 1; i < lines.length; i++) {
      var m = lines[i].match(/^\((\d+)\s*\/\s*(\d+) Questions Answered\)/i);   // may be followed by "33% Correct"
      if (!m) continue;
      var name = lines[i - 1], c = OITE.code(name);
      if (!c) continue;
      var succ = null, fail = null;
      for (var j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        var s = lines[j].match(/^(\d+(?:\.\d+)?)% Complete \(success\)/i); if (s) succ = +s[1];
        var f = lines[j].match(/^(\d+(?:\.\d+)?)% Complete \(failure\)/i); if (f) fail = +f[1];
      }
      banks[c] = { name: name, answered: +m[1], total: +m[2], succ: succ, fail: fail };
      n++;
    }
    if (n < 5) return;
    OITE.mutate([], function (st) {
      var old = st.dashboard && JSON.stringify(st.dashboard.banks);
      if (old === JSON.stringify(banks)) return false;
      st.dashboard = { ts: Date.now(), banks: banks };
    });
  }
  var dashTimer = null;
  function rememberBuildLink() {
    var a = [].slice.call(document.querySelectorAll('a[href*="/assessment/self/quiz/"]')).filter(function (x) { return /build\s*a\s*quiz/i.test(x.innerText || ""); })[0];
    if (a && /^https:\/\/learn\.aaos\.org\/diweb\//.test(a.href)) chrome.storage.local.set({ rsBuildUrl: a.href });
  }
  function watchDashboard() {
    if (!/\/assessment\/self\/home\//.test(location.pathname)) return;
    setTimeout(rememberBuildLink, 3000);
    var obs = new MutationObserver(function () { clearTimeout(dashTimer); dashTimer = setTimeout(parseDashboard, 900); });
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    setTimeout(parseDashboard, 2500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchDashboard);
  else watchDashboard();
})();
