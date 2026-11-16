// Isolated-world script on orthobullets.com. Logs every Orthobullets question
// you answer (QID, stem, choices, your pick, the right answer, peer %, and the
// explanation) into chrome.storage.local under "obQuestions", keyed by QID.
// Kept apart from the ResStudy "quizzes" log, so nothing here reaches the
// Block Plan until that is wanted.
(function () {
  if (window.__oiteOB) return;
  window.__oiteOB = true;

  function clean(s) { return String(s || "").replace(/[ \t\r\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(); }
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  // Test name + code, e.g. "OITE Practice Test 2" / "P-2CDD2EE".
  function testInfo() {
    var code = null;
    try { code = new URL(location.href).searchParams.get("test"); } catch (e) {}
    var name = null;
    if (code) {
      var lines = (document.body.innerText || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      var i = lines.indexOf(code);
      if (i > 0) name = lines[i - 1].slice(0, 120);
    }
    return { code: code, name: name };
  }

  // url("...") from a CSS background; the quoted form may hold ( and ) (e.g. "x-ray (lateral).jpg").
  function cssUrl(bg) {
    var m = /url\((["'])(.*?)\1\)/.exec(bg || "") || /url\(([^)"']+)\)/.exec(bg || "");
    return m ? (m[2] !== undefined ? m[2] : m[1]) : null;
  }
  // Orthobullets' mastery prompt ("Highlight or note the key tested concept ... to advance to 60%") isn't part of the explanation.
  function dropPrompt(s) { return s.replace(/\n*\d*\s*\n*Highlight or note the key [^\n]*$/i, "").trim(); }

  // Reads the question currently shown. Returns null until it has been answered.
  function read(q) {
    var qid = q.id;
    if (!/^\d+$/.test(qid || "")) return null;
    var items = [].slice.call(q.querySelectorAll(".answerItem")).filter(function (a) {
      return !a.classList.contains("type-wrong") && a.querySelector(".answerText");
    });
    if (!items.length) return null;
    var correct = 0, selected = 0, crossed = [];
    var choices = items.map(function (a, i) {
      if (a.classList.contains("right")) correct = i + 1;
      if (a.classList.contains("selected")) selected = i + 1;
      if (a.classList.contains("line-through")) crossed.push(i + 1);
      var pref = a.querySelector(".preferred");
      var m = pref && (pref.innerText || "").match(/(\d+)%[\s\S]*?(\d+)\s*\/\s*(\d+)/);
      return { n: i + 1, text: clean(a.querySelector(".answerText").innerText).slice(0, 600),
               pct: m ? +m[1] : null, count: m ? +m[2] : null };
    });
    var answered = q.classList.contains("question--answered") || !!correct;
    if (!answered) return null;

    var crumbs = [].slice.call(q.querySelectorAll(".breadcrumbs-section__path-item")).map(function (e) { return clean(e.innerText); });
    var ref = null, topic = [];
    crumbs.forEach(function (c) {
      var m = c.match(/^QID:\s*\d+\s*(?:\(([^)]+)\))?/i);
      if (m) ref = m[1] || null; else if (c) topic.push(c);
    });
    var stemEl = q.querySelector(".question__text");
    var explEl = q.querySelector('[id="question-notes-section-text' + qid + '-prefered"]') ||
                 q.querySelector("section.preferredResponse .question-notes-section-text");
    // Figures: the question's own pictures are drawn as a background image on .question__image (beside the
    // stem, not inside it); the explanation can hold more as <img>. Only Orthobullets' upload host counts,
    // so commenters' avatars and site icons are left out.
    var figs = [], FIG = /^https:\/\/upload\.orthobullets\.com\/(question|topic|questions)\//i;
    function addFig(u) {
      u = String(u || "").replace(/\?.*$/, "");
      if (FIG.test(u) && !/\.svg$/i.test(u) && figs.indexOf(u) < 0 && u.length < 500) figs.push(u);
    }
    q.querySelectorAll(".question__image, [class*='question__image']").forEach(function (el) {
      var u = cssUrl(getComputedStyle(el).backgroundImage);
      if (u) addFig(u);
      var a = el.closest("a"); if (a && a.href) addFig(a.href);
    });
    [stemEl, explEl].forEach(function (root) {
      if (!root) return;
      root.querySelectorAll("img").forEach(function (im) { addFig(im.currentSrc || im.src); });
      root.querySelectorAll("[style*='background-image']").forEach(function (el) {
        var u = cssUrl(el.style.backgroundImage); if (u) addFig(u);
      });
    });
    var pos = document.querySelector(".card-slider__dropdown-quantity");
    return {
      qid: qid, ref: ref, topic: topic,
      stem: stemEl ? clean(stemEl.innerText).slice(0, 8000) : "",
      choices: choices, correct: correct || null, selected: selected || null, crossed: crossed,
      result: correct && selected ? (correct === selected ? "correct" : "incorrect") : null,
      explanation: explEl ? dropPrompt(clean(explEl.innerText)).slice(0, 30000) : "",
      figs: figs.slice(0, 12),
      position: pos ? clean(pos.innerText) : null
    };
  }

  var chain = Promise.resolve();
  // One save at a time across every Orthobullets tab, so two tabs can't overwrite each other's new questions.
  function withLock(fn) {
    try { if (navigator.locks && navigator.locks.request) return navigator.locks.request("oite-ob-save", fn); } catch (e) {}
    return fn();
  }
  function save(rec) {
    chain = chain.then(function () {
      return withLock(function () { return chrome.storage.local.get("obQuestions").then(function (st) {
        var all = st.obQuestions || {};
        var old = all[rec.qid] || {};
        var t = testInfo();
        // A review page (/testview, from a test's results) isn't a new answer: it can fill in a question
        // that was missed live, but it adds no attempt and its "test" parameter is the question's ref, not a test.
        var review = /^\/testview/i.test(location.pathname);
        if (review) t = { code: null, name: null };
        var merged = Object.assign({}, old, rec, {
          source: "orthobullets",
          test: t.code ? { code: t.code, name: t.name || (old.test && old.test.name) || null } : (old.test || null),
          // first time it was answered is the day it counts for
          date: old.date || today(),
          review: old.result ? !!old.review : review,
          firstAt: old.firstAt || new Date().toISOString(),
          updatedAt: Date.now()
        });
        // every attempt you've made at this QID, one per test (or per day), oldest first
        var att = Array.isArray(old.attempts) ? old.attempts.slice() : [];
        if (!att.length && old.result) att.push({ d: old.date || today(), test: old.test && old.test.code || null, sel: old.selected || null, res: old.result });
        if (rec.result && !review) {
          var key = (t.code || "") + "|" + (t.code ? "" : today());
          var hit = att.filter(function (x) { return ((x.test || "") + "|" + (x.test ? "" : x.d)) === key; })[0];
          if (!hit) att.push({ d: today(), test: t.code || null, sel: rec.selected, res: rec.result });
        }
        merged.attempts = att.slice(-30);
        // keep the first result you got; later reviews of the same QID don't overwrite it
        if (!review && old.review && rec.result) merged.review = false;
        if (old.result && old.result !== rec.result) { merged.result = old.result; merged.selected = old.selected; merged.lastResult = rec.result; }
        // keep the longest explanation / stem seen
        if (old.explanation && old.explanation.length > (rec.explanation || "").length) merged.explanation = old.explanation;
        if (old.stem && old.stem.length > (rec.stem || "").length) merged.stem = old.stem;
        var sig = JSON.stringify([merged.review, merged.result, merged.selected, merged.correct, merged.explanation.length, merged.figs.length, merged.stem.length, merged.attempts.length]);
        if (old.__sig === sig) return;
        merged.__sig = sig;
        all[rec.qid] = merged;
        return chrome.storage.local.set({ obQuestions: all });
      }); });
    }).catch(function (e) { console.warn("[OITE Tracker / Orthobullets]", e); });
  }

  // The old version waited for the page to be still for 0.7 s. After a right answer Orthobullets keeps the page busy
  // (mastery prompt), so clicking Next quickly meant the question was never read. Now: read at most every 250 ms while
  // the page changes, and also right before anything you click or press can move you to the next question.
  var last = {}, timer = null, lastRun = 0;
  var sentTest = null;
  function reportTest() {
    if (/^\/testview/i.test(location.pathname)) return;
    var t = testInfo();
    if (!t.code || t.code === sentTest || !/^[A-Z0-9]{5,10}$/.test(t.code) || /^(OBQ|SBQ)\d/i.test(t.code)) return;
    sentTest = t.code;
    try { chrome.runtime.sendMessage({ type: "obTest", code: t.code, name: t.name }); } catch (e) {}
  }
  function scan() {
    lastRun = Date.now(); timer = null;
    reportTest();
    document.querySelectorAll(".question-item").forEach(function (q) {
      var rec = null;
      try { rec = read(q); } catch (e) { console.warn("[OITE Tracker / Orthobullets]", e); }
      if (!rec) return;
      var sig = JSON.stringify([rec.result, rec.selected, rec.correct, rec.explanation.length, rec.figs.length, rec.stem.length, rec.position]);
      if (last[rec.qid] === sig) return;   // nothing new on screen
      last[rec.qid] = sig; save(rec);
    });
  }
  function queue() {
    if (timer) return;
    timer = setTimeout(scan, Math.max(0, 250 - (Date.now() - lastRun)));
  }
  function now() { clearTimeout(timer); scan(); }

  function start() {
    new MutationObserver(queue).observe(document.documentElement,
      { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    // capture phase: runs before the page's own click/key handlers swap the question out
    ["pointerdown", "click", "keydown"].forEach(function (ev) { document.addEventListener(ev, now, true); });
    window.addEventListener("pagehide", now);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") now(); });
    queue();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
