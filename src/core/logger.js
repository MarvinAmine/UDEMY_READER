// /src/core/logger.js
(function () {
  if (window.czCore && window.czCore.log) return;

  function log(scope, ...args) {
    try {
      console.log(`[UdemyReader][${scope}]`, ...args);
    } catch (_) {
      // ignore
    }
  }

  window.czCore = window.czCore || {};
  window.czCore.log = log;
})();
