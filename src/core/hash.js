// /src/core/hash.js
// Stable hash for question identity when Udemy doesn't expose a native questionId.

(function () {
  if (window.czCore && window.czCore.hashString) return;

  function hashString(str) {
    // Simple, deterministic hash (djb2 variant, XOR).
    let hash = 5381;
    const len = (str || "").length;
    for (let i = 0; i < len; i += 1) {
      hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
    // Force unsigned 32-bit and prefix to avoid collisions with native IDs.
    return "q_" + (hash >>> 0).toString(16);
  }

  window.czCore = window.czCore || {};
  window.czCore.hashString = hashString;
})();
