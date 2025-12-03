// /src/ui/toolbar.js
(function () {
  window.czUI = window.czUI || {};
  if (window.czUI.toolbar) return;

  const state = (window.czCore && window.czCore.state) || null;
  const collapseState =
    (window.czCore && window.czCore.collapseState) || { collapsed: false };

  const PLAY_ACTIONS = ["play-question", "play-question-expl", "play-selection"];

  function getPlayLabel(action) {
    if (action === "play-question") return "▶ Play Q + answers";
    if (action === "play-question-expl") return "▶ Play explanation";
    if (action === "play-selection") return "▶ Play selection";
    return "▶ Play";
  }

  function getPauseLabel() {
    return "⏸ Pause";
  }

  function getResumeLabel() {
    return "⏯ Resume";
  }

  function updateToolbarButtonsForActiveCard() {
    if (!state || !state.activeCard) return;

    const card = state.activeCard;
    const wrapper = card.wrapper;
    if (!wrapper) return;

    const toolbar = wrapper.querySelector(".cz-tts-toolbar");
    if (!toolbar) return;

    const sessionActive = state.isPlaying || state.isPaused;
    const buttons = toolbar.querySelectorAll("button.cz-tts-btn");

    buttons.forEach((btn) => {
      const action = btn.dataset.action;
      if (PLAY_ACTIONS.includes(action)) {
        if (!sessionActive || state.currentAction !== action) {
          btn.disabled = false;
          btn.textContent = getPlayLabel(action);
        } else {
          btn.disabled = false;
          if (state.isPaused) {
            btn.textContent = getResumeLabel(action);
          } else {
            btn.textContent = getPauseLabel(action);
          }
        }
      } else if (action === "stop") {
        btn.disabled = !sessionActive;
      } else if (action === "toggle-collapse") {
        btn.textContent = collapseState.collapsed ? "▸ Show all" : "▾ Hide all";
      }
    });
  }

  window.czUI.toolbar = {
    updateToolbarButtonsForActiveCard,
    PLAY_ACTIONS,
    getPlayLabel,
    getPauseLabel,
    getResumeLabel
  };
})();
