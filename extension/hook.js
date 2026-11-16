// Runs in the page's own JS world on learn.aaos.org. Watches the ResStudy
// test-engine REST calls and hands request/response pairs to resstudy.js.
(function () {
  if (window.__oiteHooked) return;
  window.__oiteHooked = true;
  var RE = /\/diweb\/ws\/rest\/te\//;
  function parse(s) {
    if (typeof s !== "string" || !s) return null;
    try { return JSON.parse(s); } catch (e) { return null; }
  }
  function emit(url, reqBody, resText) {
    try {
      if (!RE.test(url) || /keep-alive/.test(url)) return;
      window.postMessage({ __oite: "xhr", url: String(url).split("?")[0],
        req: parse(reqBody), res: parse(resText) }, location.origin);
    } catch (e) {}
  }
  var X = XMLHttpRequest.prototype, open = X.open, send = X.send;
  X.open = function (m, u) { this.__oiteUrl = u; return open.apply(this, arguments); };
  X.send = function (body) {
    var xhr = this;
    xhr.addEventListener("load", function () {
      if (xhr.responseType && xhr.responseType !== "text" && xhr.responseType !== "") return;
      emit(xhr.__oiteUrl, typeof body === "string" ? body : null, xhr.responseText);
    });
    return send.apply(this, arguments);
  };
  // Results page (after a quiz or simulated exam, or from Exam and Quiz History):
  // report every question's right/wrong, then fetch the review data for any
  // question the tracker is missing. Same request the page makes when you click a box.
  var reported = {};
  function findResults() {
    if (!window.angular || !/\/assessment\//.test(location.pathname)) return null;
    var nodes = document.querySelectorAll("main *");
    for (var i = 0; i < nodes.length && i < 600; i++) {
      try {
        var sc = window.angular.element(nodes[i]).scope();
        if (sc && sc.te && Array.isArray(sc.te.questionResults) && sc.te.testAttemptId) return sc.te;
      } catch (e) {}
    }
    return null;
  }
  setInterval(function () {
    var te = findResults();
    if (!te || reported[te.testAttemptId]) return;
    reported[te.testAttemptId] = true;
    window.postMessage({ __oite: "results", testAttemptId: te.testAttemptId, name: te.name || "",
      results: te.questionResults.map(function (q) {
        return { index: q.index, result: q.result, questionAttemptId: q.questionAttemptId };
      }) }, location.origin);
  }, 2000);
  window.addEventListener("message", function (e) {
    if (e.source !== window || !e.data || e.data.__oite !== "need") return;
    var ids = (e.data.ids || []).slice(0, 260), taid = e.data.testAttemptId, $http;
    try { $http = window.angular.element(document.querySelector("[ng-app]") || document.body).injector().get("$http"); } catch (err) { return; }
    var url = location.origin + "/diweb/ws/rest/te/tracking/question-attempt/";
    var archived = false, switched = false;
    function send(r) { window.postMessage({ __oite: "review", testAttemptId: taid, data: JSON.parse(JSON.stringify(r.data || {})) }, location.origin); }
    (function next(i) {
      if (i >= ids.length) return;
      var body = function () { return { questionAttemptId: ids[i], archived: archived, testAttemptId: taid }; };
      $http.post(url, body()).then(send, function () {
        // A quiz ResStudy has re-filed in its history only answers with archived:true.
        if (switched) return;
        switched = true; archived = !archived;
        return $http.post(url, body()).then(send, function () {});
      }).then(function () { setTimeout(function () { next(i + 1); }, 200); });
    })(0);
  });

  if (window.fetch) {
    var f = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      var body = init && typeof init.body === "string" ? init.body : null;
      return f.apply(this, arguments).then(function (r) {
        if (RE.test(url)) r.clone().text().then(function (t) { emit(url, body, t); }).catch(function () {});
        return r;
      });
    };
  }
})();
