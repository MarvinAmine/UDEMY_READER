// /src/engines/highlight.js
(function () {
  window.czEngines = window.czEngines || {};
  if (window.czEngines.highlight) return;

  const state = (window.czCore && window.czCore.state) || null;
  const log = (window.czCore && window.czCore.log) || (() => {});

  if (!state) {
    log("Highlight", "No core state found.");
  }

  function wrapTextNodes(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    textNodes.forEach((node) => {
      const text = node.nodeValue;
      const parent = node.parentNode;
      const frag = document.createDocumentFragment();
      const parts = text.split(/(\s+)/);

      parts.forEach((part) => {
        if (!part) return;
        if (/\s+/.test(part)) {
          frag.appendChild(document.createTextNode(part));
        } else {
          const span = document.createElement("span");
          span.className = "cz-tts-word";
          span.textContent = part;
          frag.appendChild(span);
        }
      });

      parent.replaceChild(frag, node);
    });
  }

  function prepareHighlightWords() {
    if (!state || !state.activeCard) {
      if (state) {
        state.highlight.words = [];
        state.highlight.index = -1;
      }
      return;
    }

    const card = state.activeCard;
    const config = card.config;
    if (!config || typeof config.getHighlightRoots !== "function") {
      state.highlight.words = [];
      state.highlight.index = -1;
      return;
    }

    const roots = config.getHighlightRoots(state.currentAction) || [];
    const uniqueRoots = Array.from(new Set(roots.filter(Boolean)));

    uniqueRoots.forEach((root) => {
      if (!root.dataset.czTtsWrapped) {
        wrapTextNodes(root);
        root.dataset.czTtsWrapped = "1";
      }
    });

    const words = [];
    uniqueRoots.forEach((root) => {
      words.push(...root.querySelectorAll(".cz-tts-word"));
    });

    state.highlight.words = words;
    state.highlight.index = -1;

    const combinedLength = (state.currentText || "").length || 1;
    const wordCount = Math.max(words.length, 1);
    const estimatedSeconds = combinedLength / 13;
    const intervalMs = (estimatedSeconds * 1000) / wordCount;

    state.highlight.intervalMs = Math.min(
      600,
      Math.max(120, Math.round(intervalMs))
    );

    log(
      "Highlight",
      "Prepared words:",
      wordCount,
      "combined length:",
      combinedLength,
      "intervalMs:",
      state.highlight.intervalMs
    );
  }

  function clearHighlight() {
    if (!state) return;
    state.highlight.words.forEach((w) =>
      w.classList.remove("cz-tts-word-current")
    );
  }

  function stopHighlightTimer(resetIndex) {
    if (!state) return;
    if (state.highlight.timerId) {
      clearInterval(state.highlight.timerId);
      state.highlight.timerId = null;
    }
    clearHighlight();
    if (resetIndex) state.highlight.index = -1;
  }

  function startHighlightTimer(fromCurrent) {
    if (!state) return;

    stopHighlightTimer(false);
    if (!state.highlight.words.length) return;

    const wordCount = state.highlight.words.length;
    let idx = fromCurrent ? state.highlight.index : -1;

    state.highlight.timerId = setInterval(() => {
      if (!state.isPlaying || state.isPaused) return;

      if (idx >= 0 && idx < wordCount) {
        state.highlight.words[idx].classList.remove("cz-tts-word-current");
      }

      idx += 1;
      if (idx >= wordCount) {
        stopHighlightTimer(true);
        return;
      }

      state.highlight.index = idx;
      const el = state.highlight.words[idx];
      el.classList.add("cz-tts-word-current");

      if (state.highlight.autoScroll) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, state.highlight.intervalMs);
  }

  window.czEngines.highlight = {
    prepareHighlightWords,
    startHighlightTimer,
    stopHighlightTimer,
    clearHighlight
  };
})();
