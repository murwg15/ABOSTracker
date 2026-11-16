// Isolated-world script on the ResStudy and Orthobullets test builders.
// When the Block Plan asked for a test (tap on a block's box), the background
// worker opened this tab with a job. This script sets every option for that
// block and stops before Start / Begin, which you press yourself.
(function () {
  if (window.top !== window || window.__oiteBuild) return;
  window.__oiteBuild = true;

  var W = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var job = null;
  function status(st, msg, extra) {
    if (!job) return;
    var m = { type: "buildStatus", reqId: job.reqId, status: st, msg: msg };
    if (extra) for (var k in extra) m[k] = extra[k];
    try { chrome.runtime.sendMessage(m); } catch (e) {}
  }
  function fail(msg) { status("error", msg); banner(msg, true); }
  function waitFor(fn, ms) {
    var end = Date.now() + (ms || 20000);
    return new Promise(function (res, rej) {
      (function poll() {
        var v; try { v = fn(); } catch (e) { v = null; }
        if (v) return res(v);
        if (Date.now() > end) return rej(new Error("timeout"));
        setTimeout(poll, 200);
      })();
    });
  }
  // A small note at the top of the page so it's clear what was set up.
  function banner(msg, err) {
    var b = document.getElementById("oite-build-banner");
    if (!b) {
      b = document.createElement("div"); b.id = "oite-build-banner";
      b.style.cssText = "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:560px;" +
        "padding:10px 16px;font:14px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;color:#fff;border-radius:6px;" +
        "box-shadow:0 6px 24px rgba(0,0,0,.3);cursor:pointer";
      b.title = "Click to dismiss";
      b.addEventListener("click", function () { b.remove(); });
      document.documentElement.appendChild(b);
    }
    b.style.background = err ? "#a33a2a" : "#1f6f8b";
    b.textContent = "OITE Tracker: " + msg;
  }

  // ---------------- Orthobullets: /qbank/createGroupTest.aspx ----------------
  var OB_SPEC = { "Trauma": 1, "Spine": 2, "Shoulder & Elbow": 3, "Knee & Sports": 225, "Pediatrics": 4, "Recon": 5,
                  "Hand": 6, "Foot & Ankle": 7, "Pathology": 8, "Basic Science": 9, "Anatomy": 10, "Approaches": 12 };
  var OB_SRC = { "OBQ": "source-2", "SBQ": "source-1", "AAOS SAE": "source-3" };
  var OB_IMP = { A: "filterImportance5", B: "filterImportance4", C: "filterImportance1", D: "filterImportance2", E: "filterImportance3" };
  var OB_STATE = { "Unused": "unusedQ", "Used and Correct": "usedQ", "Used and Incorrect": "incorrectQ" };
  var OB_MODE = { "Learning": "qModeFilterLearn", "Practice": "qModeFilterPractice", "Open-Book": "qModeFilterSaeTesting", "Test": "qModeFilterTesting" };
  function $(id) { return document.getElementById(id); }
  async function setBox(el, on) { if (el && el.checked !== on) { el.click(); await W(80); } }
  // "All / none" boxes: checking one turns its whole group on, unchecking turns it off.
  async function group(allId, ids, wanted) {
    var all = $(allId);
    if (wanted === "all") { if (all && !all.checked) { all.click(); await W(150); } for (var i = 0; i < ids.length; i++) await setBox($(ids[i]), true); return; }
    if (all && all.checked) { all.click(); await W(150); }
    for (var j = 0; j < ids.length; j++) await setBox($(ids[j]), wanted.indexOf(ids[j]) >= 0);
  }
  async function allOn(allId) { var a = $(allId); if (a && !a.checked) { a.click(); await W(150); } }
  function setText(el, v) {
    if (!el) return;
    el.focus(); el.value = String(v);
    ["input", "change", "keyup"].forEach(function (t) { el.dispatchEvent(new Event(t, { bubbles: true })); });
    el.blur();
  }
  function obCount() {
    var c = document.querySelector(".calc_all_count");
    var t = c ? c.innerText || "" : "";
    var m = t.replace(/,/g, "").match(/(\d+)\s+QUESTIONS? AVAILABLE/i);
    return m ? +m[1] : null;
  }
  async function settledCount() {
    var last = null, same = 0;
    for (var i = 0; i < 40; i++) {
      await W(250);
      var c = obCount();
      if (c !== null && c === last) { if (++same >= 3) return c; } else same = 0;
      last = c;
    }
    return last;
  }
  async function buildOB(spec) {
    await waitFor(function () { return $("btn_preview") && $("allQImportances") && $("allSpec") && document.querySelector(".calc_all_count"); }, 30000)
      .catch(function () { throw new Error("The Orthobullets test builder didn't load. Are you signed in to Orthobullets?"); });
    await W(600);
    status("progress", "Setting up Orthobullets…");
    // Everything not in the block's filters back to its default (all on).
    var allIds = ["allQTier", "allQLevel", "allQYear", "allQFilterMastery", "allTopicFilterMastery", "allArticleFilterMastery"];
    for (var i = 0; i < allIds.length; i++) await allOn(allIds[i]);
    // Source
    var srcIds = [].slice.call(document.querySelectorAll('input[type=checkbox][id^="source-"]')).map(function (e) { return e.id; });
    var wantSrc = (spec.sources || ["OBQ", "SBQ"]).map(function (s) { return OB_SRC[s]; }).filter(Boolean);
    for (var s = 0; s < srcIds.length; s++) await setBox($(srcIds[s]), wantSrc.indexOf(srcIds[s]) >= 0);
    // Importance ("all" = filter off, which also keeps unrated questions)
    var impIds = Object.keys(OB_IMP).map(function (k) { return OB_IMP[k]; });
    await group("allQImportances", impIds, (!spec.importance || spec.importance === "all") ? "all"
      : spec.importance.map(function (k) { return OB_IMP[k]; }).filter(Boolean));
    // Question state
    var stIds = Object.keys(OB_STATE).map(function (k) { return OB_STATE[k]; });
    var st = (spec.state || ["Unused"]).map(function (k) { return OB_STATE[k]; }).filter(Boolean);
    await group("allQState", stIds, st.length === stIds.length ? "all" : st);
    // Specialties
    var spIds = [].slice.call(document.querySelectorAll("input.specialtyCheckbox--topic")).map(function (e) { return e.id; })
      .filter(function (id) { return id !== "allSpec"; });
    var wantSp;
    if (spec.specialties === "all") wantSp = "all";
    else {
      wantSp = (spec.specialties || []).map(function (n) { return OB_SPEC[n] ? "specFilter" + OB_SPEC[n] : null; }).filter(Boolean);
      if (!wantSp.length) throw new Error("Unknown Orthobullets specialty: " + (spec.specialties || []).join(", "));
    }
    await group("allSpec", spIds, wantSp);
    // Mode, timing, name
    var mode = $(OB_MODE[spec.mode] || OB_MODE.Learning);
    if (mode && !mode.checked) { mode.click(); await W(300); }
    // Timed blocks: turn off "No time limit" so the seconds-per-question box takes effect; otherwise leave it on.
    var ntl = $("cbNoTimeLimit");
    if (spec.secondsPerQuestion) { await setBox(ntl, false); await W(200);
      var tpq = $("txtTimePerQuestion"); if (tpq && tpq.disabled) tpq.disabled = false;
      setText(tpq, spec.secondsPerQuestion); }
    else await setBox(ntl, true);
    if (spec.name) setText($("txtTestName"), spec.name);
    status("progress", "Counting matching questions…");
    var avail = await settledCount();
    if (avail === 0) throw new Error("No Orthobullets questions match this block's filters. Nothing to build.");
    var n = Math.max(1, Math.min(spec.n || 50, avail || spec.n || 50));
    setText($("txtNumQuestions"), n);
    await W(300);
    var btn = $("btn_preview");
    if (btn) {
      btn.scrollIntoView({ block: "center", behavior: "smooth" });
      btn.style.outline = "3px solid #f2b134"; btn.style.outlineOffset = "3px";
    }
    var msg = "Orthobullets test ready: " + n + " questions" + (avail != null ? " (" + avail + " match)" : "") +
              (n < (spec.n || 50) ? ", fewer than the block's " + spec.n + " because that's all that's left" : "") +
              ". Check it and press Start Custom Test.";
    banner(msg);
    status("ready", msg, { matched: avail, n: n });
  }

  // ---------------- ResStudy: Build a Quiz (AngularJS wizard) ----------------
  // The wizard's question count lives in an Angular model, which only the page's own
  // JS world can set, so build-main.js runs the steps and reports back here.
  function buildRS(spec) {
    if (spec.bank) {
      throw new Error((spec.bank || "This bank") + " isn't in ResStudy's Build a Quiz. Open it from your ResStudy courses instead.");
    }
    status("progress", "Setting up ResStudy…");
    return new Promise(function (res, rej) {
      var done = false;
      function on(e) {
        if (e.source !== window || !e.data || e.data.__oiteBuild !== "result") return;
        done = true; window.removeEventListener("message", on);
        if (e.data.ok) res(e.data); else rej(new Error(e.data.msg || "ResStudy build failed."));
      }
      window.addEventListener("message", on);
      window.postMessage({ __oiteBuild: "run", spec: spec }, location.origin);
      setTimeout(function () { if (!done) { window.removeEventListener("message", on); rej(new Error("ResStudy's Build a Quiz didn't respond. Are you signed in to ResStudy?")); } }, 60000);
    }).then(function (r) {
      if (r.resumed) { status("ready", "Reopened your unfinished ResStudy quiz" + (r.summary ? " (" + r.summary + ")" : "") + ".", { n: r.n }); return; }
      var msg = (r.note ? r.note + " " : "") + "ResStudy quiz ready: " + r.summary + ". Check it and press Begin.";
      banner(msg);
      status("ready", msg, { n: r.n });
    });
  }

  function start() {
    try {
      chrome.runtime.sendMessage({ type: "buildJob" }).then(function (j) {
        if (!j || !j.spec) return;
        job = j;
        var isOB = /orthobullets\.com$/.test(location.hostname);
        if (isOB !== (j.spec.src === "orthobullets")) return;
        if (isOB && !/createGroupTest\.aspx/i.test(location.pathname)) return;
        if (!isOB && !/\/assessment\/self\/quiz\//.test(location.pathname)) return;
        chrome.runtime.sendMessage({ type: "buildClaim" });   // one try per job
        var p;
        try { p = isOB ? buildOB(j.spec) : buildRS(j.spec); } catch (e) { p = Promise.reject(e); }
        Promise.resolve(p).catch(function (e) { fail((e && e.message) || "The test couldn't be set up."); });
      }).catch(function () {});
    } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
