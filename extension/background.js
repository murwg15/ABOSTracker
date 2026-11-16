// Background sync: after a ResStudy session goes quiet, and again at 8:50 pm,
// open the Block Plan in a background tab just long enough for it to save
// the new results, then close it. Keeps the plan (and the nightly summary)
// current even if you never open the plan yourself.
var PLAN = "https://claude.ai/artifact/P4N2XEaN54snPt57P11Zpo";

function scheduleNightly() {
  var d = new Date(); d.setHours(20, 50, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  chrome.alarms.create("nightly", { when: d.getTime(), periodInMinutes: 1440 });
}
chrome.runtime.onInstalled.addListener(scheduleNightly);
chrome.runtime.onStartup.addListener(scheduleNightly);

chrome.storage.onChanged.addListener(function (ch, area) {
  if (area !== "local") return;
  if (ch.quizzes || ch.dashboard || ch.obQuestions || Object.keys(ch).some(function (k) { return k.indexOf("rsq:") === 0; })) {
    chrome.storage.local.set({ lastChange: Date.now() });
    chrome.alarms.create("sync", { delayInMinutes: 6 });   // resets while you keep answering
  }
  if (ch.lastSync) {
    chrome.storage.local.get("syncTabId").then(function (st) {
      if (!st.syncTabId) return;
      setTimeout(function () { chrome.tabs.remove(st.syncTabId).catch(function () {}); }, 1500);
      chrome.storage.local.remove("syncTabId");
    });
  }
});

function openSyncTab() {
  return chrome.tabs.create({ url: PLAN, active: false, pinned: true }).then(function (tab) {
    chrome.storage.local.set({ syncTabId: tab.id, lastPull: Date.now() });
    chrome.alarms.create("syncClose", { delayInMinutes: 4 });   // long enough to save a batch of question figures
  });
}
// "pull": fetch what other devices logged, even when this device has nothing new to send.
chrome.runtime.onMessage.addListener(function (msg) {
  if (!msg || msg.type !== "pull") return;
  chrome.storage.local.get(["bgSync", "syncTabId", "lastPull", "lastSync"]).then(function (st) {
    if (st.bgSync === false || st.syncTabId) return;
    var last = Math.max(st.lastPull || 0, st.lastSync || 0);
    if (Date.now() - last < (msg.minGapMin || 5) * 60000) return;
    openSyncTab();
  });
});

// Question figures. Only ResStudy's own image hosts are fetched, and only for the plan's bridge.
var FIG_OK = /^https:\/\/(cdn\.mycrowdwisdom\.com\/aaos\/|s3\.amazonaws\.com\/media\.mycrowdwisdom\.com\/aaos\/|upload\.orthobullets\.com\/)[^?#]+\.(jpe?g|png|gif|webp)$/i;
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.type !== "fig") return;
  if (sender.id !== chrome.runtime.id || typeof msg.url !== "string" || !FIG_OK.test(msg.url)) {
    sendResponse({ ok: false, error: "not allowed" }); return;
  }
  fetch(msg.url, { credentials: "omit" }).then(function (r) {
    if (!r.ok) throw new Error("http " + r.status);
    return r.blob();
  }).then(function (b) {
    if (!b.size || b.size > 8e6) throw new Error("size");
    var ext = msg.url.split(".").pop().toLowerCase();
    var type = /^image\//.test(b.type) ? b.type : "image/" + (ext === "jpg" ? "jpeg" : ext);
    return b.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf), s = "";
      for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      sendResponse({ ok: true, data: "data:" + type + ";base64," + btoa(s) });
    });
  }).catch(function (e) { sendResponse({ ok: false, error: String((e && e.message) || e).slice(0, 80) }); });
  return true;   // answer arrives later
});

chrome.alarms.onAlarm.addListener(function (a) {
  if (a.name === "sync" || a.name === "nightly") {
    chrome.storage.local.get(["lastChange", "lastSync", "bgSync", "syncTabId"]).then(function (st) {
      if (st.bgSync === false || st.syncTabId) return;
      if (a.name === "sync" && (st.lastChange || 0) <= (st.lastSync || 0)) return;
      openSyncTab();
    });
  }
  if (a.name === "syncClose") {
    chrome.storage.local.get("syncTabId").then(function (st) {
      if (st.syncTabId) chrome.tabs.remove(st.syncTabId).catch(function () {});
      chrome.storage.local.remove("syncTabId");
    });
  }
});

// ---------- Build a block's test (asked for by the Block Plan's Today boxes) ----------
// The plan sends the block's build spec; this opens the right builder in a new tab and
// hands the spec to build.js there, which sets every option and stops before Start/Begin.
var OB_BUILDER = "https://www.orthobullets.com/qbank/createGroupTest.aspx";
var RS_BUILDER = "https://learn.aaos.org/diweb/assessment/self/quiz/sid/214324727/psid/213944919/self-eid/6328393/hideAttemptList/true/hideGoToChapter/true/self-sid/213944919/pid/6328393/chapterId/6328393/chapterPkgSubId/213944919";
var jobStore = chrome.storage.session || chrome.storage.local;
function getJobs() { return jobStore.get("buildJobs").then(function (st) { return st.buildJobs || {}; }); }
function setJobs(j) { return jobStore.set({ buildJobs: j }); }
function tellPlan(job, m) {
  if (!job || !job.from) return;
  m.type = "buildStatus"; m.reqId = job.reqId;
  chrome.tabs.sendMessage(job.from.tabId, m, { frameId: job.from.frameId || 0 }).catch(function () {});
}
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || sender.id !== chrome.runtime.id) return;
  if (msg.type === "build") {
    var sp = msg.spec || {};
    if (sp.src !== "orthobullets" && sp.src !== "resstudy") { sendResponse({ ok: false, error: "This block can't be built automatically." }); return; }
    if (sp.src === "resstudy" && sp.bank) { sendResponse({ ok: false, error: sp.bank + " isn't in ResStudy's Build a Quiz; open it from your ResStudy courses." }); return; }
    chrome.storage.local.get("rsBuildUrl").then(function (st) {
      var url = sp.src === "orthobullets" ? OB_BUILDER : (st.rsBuildUrl || RS_BUILDER);
      // Reopen an unfinished ResStudy quiz: the same page with its attempt list showing (it has the Resume buttons).
      if (sp.src === "resstudy" && sp.resume) url = url.replace(/\/hideAttemptList\/true/i, "");
      return chrome.tabs.create({ url: url, active: true }).then(function (tab) {
        return getJobs().then(function (jobs) {
          var now = Date.now();
          Object.keys(jobs).forEach(function (k) { if (now - jobs[k].ts > 15 * 60000) delete jobs[k]; });
          jobs[tab.id] = { reqId: msg.reqId, spec: sp, ts: now, claimed: false,
                           from: sender.tab ? { tabId: sender.tab.id, frameId: sender.frameId || 0 } : null };
          return setJobs(jobs);
        }).then(function () { sendResponse({ ok: true }); });
      });
    }).catch(function (e) { sendResponse({ ok: false, error: "Couldn't open the test builder." }); });
    return true;
  }
  if (msg.type === "buildJob" || msg.type === "buildClaim") {
    var tid = sender.tab && sender.tab.id;
    getJobs().then(function (jobs) {
      var j = jobs[tid];
      if (!j || j.claimed || Date.now() - j.ts > 15 * 60000) { sendResponse(null); return; }
      if (msg.type === "buildClaim") { j.claimed = true; return setJobs(jobs).then(function () { sendResponse(null); }); }
      sendResponse({ reqId: j.reqId, spec: j.spec });
    });
    return true;
  }
  if (msg.type === "buildStatus") {
    var t = sender.tab && sender.tab.id;
    getJobs().then(function (jobs) {
      var j = jobs[t]; if (!j || j.reqId !== msg.reqId) return;
      tellPlan(j, { status: msg.status, msg: msg.msg, n: msg.n, matched: msg.matched });
      if (msg.status === "ready" && j.spec && j.spec.src === "orthobullets" && j.spec.code && j.spec.day) {
        // Orthobullets gives the test its ID only when you press Start, so wait for this tab to open the test.
        jobStore.get("obBuilt").then(function (st) {
          var b = st.obBuilt || {}, now = Date.now();
          Object.keys(b).forEach(function (k) { if (now - b[k].ts > 12 * 3600000) delete b[k]; });
          b[t] = { key: j.spec.code + "|" + j.spec.day, name: j.spec.name || null, ts: now };
          return jobStore.set({ obBuilt: b });
        });
      }
      if (msg.status === "ready" || msg.status === "error") { delete jobs[t]; return setJobs(jobs); }
    });
  }
});
// An Orthobullets test page is open (orthobullets.js reports its ID). If it's the tab where a block's test was
// just built, note "block -> test ID" so the plan's box can reopen that test later.
chrome.runtime.onMessage.addListener(function (msg, sender) {
  if (!msg || msg.type !== "obTest" || sender.id !== chrome.runtime.id || !/^[A-Z0-9]{5,10}$/.test(String(msg.code || ""))) return;
  var tid = sender.tab && sender.tab.id;
  jobStore.get("obBuilt").then(function (st) {
    var b = st.obBuilt || {}, hit = b[tid], now = Date.now();
    if (!hit) {
      // Start opened the test in another tab: take the one block built in the last 30 minutes, if there's exactly one.
      var recent = Object.keys(b).filter(function (k) { return now - b[k].ts < 30 * 60000; });
      if (recent.length === 1) { tid = recent[0]; hit = b[tid]; }
    }
    if (!hit) return;
    delete b[tid];
    return jobStore.set({ obBuilt: b }).then(function () {
      return chrome.storage.local.get("obTestLinks").then(function (s2) {
        var links = s2.obTestLinks || {};
        Object.keys(links).forEach(function (k) { if (now - (links[k].at || 0) > 60 * 86400000) delete links[k]; });
        links[hit.key] = { test: msg.code, name: msg.name || hit.name || null, at: now };
        return chrome.storage.local.set({ obTestLinks: links });
      });
    });
  });
});

// Builder tab closed before it finished.
chrome.tabs.onRemoved.addListener(function (tabId) {
  getJobs().then(function (jobs) {
    var j = jobs[tabId]; if (!j) return;
    tellPlan(j, { status: "error", msg: "The builder tab was closed before the test was set up." });
    delete jobs[tabId]; return setJobs(jobs);
  });
});
