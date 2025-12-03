// /src/core/state.js
(function () {
  if (window.czCore && window.czCore.state) return;

  const state = {
    initialized: false,
    ttsMode: "auto",
    hasWebVoices: false,
    googleApiKey: "",
    isPlaying: false,
    isPaused: false,
    currentText: "",
    currentUtterance: null,
    currentAudio: null,
    currentAction: null,
    activeCard: null,
    highlight: {
      words: [],
      index: -1,
      timerId: null,
      intervalMs: 250,
      autoScroll: false // keep window fixed by default
    }
  };

  // Global collapse state (shared by all cards on the page)
  const collapseState = {
    collapsed: false
  };

  window.czCore = window.czCore || {};
  window.czCore.state = state;
  window.czCore.collapseState = collapseState;
})();
