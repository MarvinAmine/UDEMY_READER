// /src/core/storage.js
(function () {
  if (window.czCore && window.czCore.storage) return;

  const storage = {
    getSync(keys, cb) {
      if (!chrome?.storage?.sync) {
        cb && cb({});
        return;
      }
      chrome.storage.sync.get(keys, cb);
    },
    setSync(obj, cb) {
      if (!chrome?.storage?.sync) {
        cb && cb();
        return;
      }
      chrome.storage.sync.set(obj, cb);
    },
    getLocal(keys, cb) {
      if (!chrome?.storage?.local) {
        cb && cb({});
        return;
      }
      chrome.storage.local.get(keys, cb);
    },
    setLocal(obj, cb) {
      if (!chrome?.storage?.local) {
        cb && cb();
        return;
      }
      chrome.storage.local.set(obj, cb);
    }
  };

  window.czCore = window.czCore || {};
  window.czCore.storage = storage;
})();
