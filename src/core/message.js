// /src/core/message.js
(function () {
  if (window.czCore && window.czCore.message) return;

  const log = (window.czCore && window.czCore.log) || (() => {});

  function sendMessage(msg, cb) {
    if (!chrome?.runtime?.sendMessage) {
      log("Message", "chrome.runtime.sendMessage not available");
      cb && cb({ ok: false, error: "NO_RUNTIME" });
      return;
    }
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        cb && cb(resp);
      });
    } catch (e) {
      log("Message", "sendMessage error", e);
      cb && cb({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  }

  window.czCore = window.czCore || {};
  window.czCore.message = { sendMessage };
})();
