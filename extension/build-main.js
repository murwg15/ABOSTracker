// Runs in the page's own JS world on ResStudy's Build a Quiz. build.js asks it to
// walk the wizard: mode -> topics -> question set -> Confirm, and stop there.
(function () {
  if (window.top !== window || window.__oiteBuildMain) return;
  window.__oiteBuildMain = true;
  var W = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function waitFor(fn, ms) {
    var end = Date.now() + (ms || 15000);
    return new Promise(function (res, rej) {
      (function poll() {
        var v; try { v = fn(); } catch (e) { v = null; }
        if (v) return res(v);
        if (Date.now() > end) return rej(new Error("timeout"));
        setTimeout(poll, 200);
      })();
    });
  }
  function vis(e) { return e && e.offsetParent !== null; }
  function labelOf(inp) {
    var l = (inp.id && document.querySelector('label[for="' + CSS.escape(inp.id) + '"]')) || inp.closest("label") || inp.parentElement;
    return ((l && (l.innerText || l.textContent)) || "").trim().split("\n")[0].trim();
  }
  function btn(v) {
    return [].slice.call(document.querySelectorAll('input[type=submit],button')).filter(function (b) {
      return vis(b) && ((b.value || b.innerText || "").trim().toLowerCase() === v.toLowerCase());
    })[0];
  }
  function closeAlerts() {
    [].slice.call(document.querySelectorAll("button")).forEach(function (b) { if (vis(b) && /^[\s×]*close$/i.test(b.innerText || "")) b.click(); });
  }
  function alertText() {
    var a = [].slice.call(document.querySelectorAll(".alert, [role=alert], .modal-body")).filter(vis).map(function (e) { return (e.innerText || "").replace(/×|Close/g, "").trim(); }).filter(Boolean);
    return a.join(" ").slice(0, 200);
  }
  function norm(s) { return String(s || "").replace(/\s*\(\d+\)\s*$/, "").trim().toLowerCase(); }
  async function next(stepCheck) {
    var b = btn("Next");
    if (!b) throw new Error("Couldn't find ResStudy's Next button.");
    b.click();
    await W(400);
    try { await waitFor(stepCheck, 12000); }
    catch (e) { var t = alertText(); throw new Error(t ? "ResStudy said: " + t : "ResStudy didn't move to the next step."); }
  }
  function onMode() { var r = document.querySelectorAll('input[type=radio][name=mode]'); return r.length && vis(r[0]); }
  function onTopics() { return vis(document.getElementById("randomQs")); }
  function onSet() { return vis(document.getElementById("unanswered")); }
  function onConfirm() { return /Confirm your quiz settings/i.test((document.querySelector("main") || document.body).innerText || "") && btn("Begin"); }

  // Reopen an unfinished attempt: the attempt list's Resume button calls resumeTest(attemptId).
  async function resume(spec) {
    var id = String(spec.resume);
    var a = await waitFor(function () { return document.querySelector("a.resumeTest") || document.querySelector('[ng-repeat*="attempt in"]'); }, 30000)
      .catch(function () { return null; });
    var sc = a && window.angular && window.angular.element(a).scope();
    while (sc && typeof sc.resumeTest !== "function") sc = sc.$parent;
    var list = sc && sc.te && sc.te.attempts || [];
    var hit = list.filter(function (x) { return String(x.attemptId) === id; })[0];
    if (!sc || !hit || !hit.resumable) return null;
    sc.$apply(function () { sc.resumeTest(hit.attemptId); });
    return { resumed: true, n: spec.n || null, summary: spec.at || "" };
  }

  async function run(spec) {
    if (spec.resume) {
      var r = await resume(spec);
      if (r) return r;
      throw new Error("ResStudy no longer lets you resume that quiz. Tap the box again to build a new one for the rest.");
    }
    // The wizard opens on the mode step; if it was left mid-way, walk back to the start.
    await waitFor(function () { return onMode() || onTopics() || onSet() || onConfirm(); }, 30000)
      .catch(function () { throw new Error("ResStudy's Build a Quiz didn't load. Are you signed in to ResStudy?"); });
    for (var g = 0; g < 4 && !onMode(); g++) { var p = btn("Previous"); if (!p) break; p.click(); await W(900); }
    if (!onMode()) throw new Error("Couldn't get to the first step of Build a Quiz.");

    // 1. Mode
    var want = /simulated/i.test(spec.mode || "") ? /simulated/i : /study/i;
    var radio = [].slice.call(document.querySelectorAll('input[type=radio][name=mode]')).filter(function (r) { return want.test(labelOf(r)); })[0];
    if (!radio) throw new Error("Couldn't find " + (spec.mode || "Study Mode") + " on ResStudy.");
    if (!radio.checked) radio.click();
    await W(250);
    await next(onTopics);

    // 2. Topics
    var rnd = document.getElementById("randomQs");
    var pools = [].slice.call(document.querySelectorAll("input[type=checkbox]")).filter(function (i) { return i !== rnd && vis(i) && /\(\d+\)\s*$/.test(labelOf(i)); });
    if (spec.topics === "random") {
      if (!rnd.checked) { rnd.click(); await W(250); }
    } else {
      if (rnd.checked) { rnd.click(); await W(250); }
      var wanted = (spec.topics || []).map(norm), found = [];
      pools.forEach(function (i) {
        var on = wanted.indexOf(norm(labelOf(i))) >= 0;
        if (on) found.push(norm(labelOf(i)));
        if (i.checked !== on) i.click();
      });
      var missing = wanted.filter(function (w) { return found.indexOf(w) < 0; });
      if (missing.length) throw new Error("ResStudy has no topic called " + missing.join(", ") + ".");
    }
    await W(250);
    await next(onSet);

    // 3. Question set: types + count (Angular model; the count box ignores typed values)
    var u = document.getElementById("unanswered"), sc = window.angular && window.angular.element(u).scope(), te = sc && sc.te;
    if (!te) throw new Error("Couldn't read ResStudy's question-set step.");
    var types = [].concat(spec.state || "Unanswered").map(function (x) { return String(x).trim().toLowerCase(); });
    var st = types.join(" + ");
    sc.$apply(function () {
      te.unansweredQuestions = types.indexOf("unanswered") >= 0;
      te.incorrectQuestions = types.indexOf("incorrect") >= 0;
      te.correctQuestions = types.indexOf("correct") >= 0;
      if (typeof sc.onChangePerformanceSelection === "function") sc.onChangePerformanceSelection();
    });
    await W(900);
    var max = +te.maxSelectedQuestionCount || 0;
    if (!max) throw new Error("No " + st.toLowerCase() + " questions left in " + (spec.topics === "random" ? "ResStudy" : spec.topics.join(", ")) + ".");
    var n = Math.max(1, Math.min(spec.n || 50, max));
    sc.$apply(function () { te.selectedQuestionCount = n; });
    await W(300);
    await next(onConfirm);

    // 4. Confirm: stop here. Begin is yours.
    var b = btn("Begin");
    if (b) { b.scrollIntoView({ block: "center" }); b.style.outline = "3px solid #f2b134"; b.style.outlineOffset = "3px"; }
    var txt = ((document.querySelector("main") || document.body).innerText || "");
    var q = (txt.match(/Questions:\s*([^\n]+)/i) || [])[1] || (n + " questions");
    var t = (txt.match(/Topics:\s*([^\n]+)/i) || [])[1] || "";
    return { n: n, summary: q.trim() + (t ? ", " + t.trim() : "") + (n < (spec.n || 50) ? " (all that's left)" : "") };
  }

  window.addEventListener("message", function (e) {
    if (e.source !== window || !e.data || e.data.__oiteBuild !== "run") return;
    closeAlerts();
    run(e.data.spec || {}).then(function (r) {
      window.postMessage({ __oiteBuild: "result", ok: true, n: r.n, summary: r.summary, resumed: !!r.resumed, note: r.note || null }, location.origin);
    }, function (err) {
      window.postMessage({ __oiteBuild: "result", ok: false, msg: (err && err.message) || "ResStudy build failed." }, location.origin);
    });
  });
})();
