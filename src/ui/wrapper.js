// /src/ui/wrapper.js
// Quiz Reader (TTS) feature

(function () {
  if (window.czFeatures && window.czFeatures.quizReader) return;

  const synth = window.speechSynthesis || null;
  const state = (window.czCore && window.czCore.state) || null;
  const collapseState =
    (window.czCore && window.czCore.collapseState) || { collapsed: false };
  const log = (window.czCore && window.czCore.log) || (() => {});

  const toolbar = (window.czUI && window.czUI.toolbar) || null;
  const highlight =
    (window.czEngines && window.czEngines.highlight) || null;
  const ttsWeb =
    (window.czEngines && window.czEngines.ttsWeb) || null;
  const ttsGoogle =
    (window.czEngines && window.czEngines.ttsGoogle) || null;

  const PLAY_ACTIONS =
    (toolbar && toolbar.PLAY_ACTIONS) ||
    ["play-question", "play-question-expl", "play-selection"];

  function initOnce() {
    if (!state || state.initialized) return;
    state.initialized = true;
    loadGoogleKey();
    initVoices();
  }

  function loadGoogleKey() {
    if (!chrome?.storage?.sync || !state) {
      log("QuizReader", "chrome.storage.sync not available");
      return;
    }
    chrome.storage.sync.get(["czGoogleTtsKey"], (res) => {
      state.googleApiKey = (res.czGoogleTtsKey || "").trim();
      log(
        "QuizReader",
        "Loaded Google TTS key from storage:",
        state.googleApiKey ? "present" : "empty"
      );
      chooseInitialMode(true);
    });
  }

  function initVoices() {
    if (!state) return;
    if (!synth) {
      log("QuizReader", "Web Speech API not available.");
      state.hasWebVoices = false;
      chooseInitialMode();
      return;
    }

    function updateVoices() {
      const list = synth.getVoices() || [];
      state.hasWebVoices = list.length > 0;
      log("QuizReader", "Voices count:", list.length);
      if (state.hasWebVoices && state.ttsMode === "auto") {
        state.ttsMode = "webspeech";
      } else if (!state.hasWebVoices) {
        chooseInitialMode();
      }
    }

    synth.onvoiceschanged = updateVoices;
    updateVoices();
    setTimeout(() => {
      if (!state.hasWebVoices) updateVoices();
    }, 2000);
  }

  function chooseInitialMode(force) {
    if (!state) return;
    if (!force && state.ttsMode !== "auto" && state.ttsMode !== "none") return;

    if (state.hasWebVoices) {
      state.ttsMode = "webspeech";
    } else if (state.googleApiKey) {
      state.ttsMode = "google";
      log("QuizReader", "Using Google Cloud TTS (no local voices).");
    } else {
      state.ttsMode = "none";
      setStatus(
        "No system voices available and no Google TTS key configured. The reader cannot speak."
      );
    }
  }

  function setStatus(msg) {
    if (!state || !state.activeCard) return;
    const card = state.activeCard;
    if (!card.statusEl) return;
    card.statusEl.textContent = msg;
  }

  function extractSelectedText() {
    const sel = window.getSelection();
    if (!sel) return "";
    return normalizeWhitespace(sel.toString());
  }

  function normalizeWhitespace(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function safeCall(fn) {
    try {
      return fn ? fn() : "";
    } catch (e) {
      log("QuizReader", "config fn error", e);
      return "";
    }
  }

  function applyCollapseStateToAllWrappers() {
    const wrappers = document.querySelectorAll(".cz-tts-wrapper");
    wrappers.forEach((el) => {
      if (collapseState.collapsed) {
        el.classList.add("cz-tts-collapsed");
      } else {
        el.classList.remove("cz-tts-collapsed");
      }
      const btn = el.querySelector(
        "button.cz-tts-btn[data-action='toggle-collapse']"
      );
      if (btn) {
        btn.textContent = collapseState.collapsed ? "▸ Show all" : "▾ Hide all";
      }
    });
  }

  function updateToolbarButtonsForActiveCard() {
    if (toolbar && toolbar.updateToolbarButtonsForActiveCard) {
      toolbar.updateToolbarButtonsForActiveCard();
    }
  }

  function handlePlayButtonClick(action) {
    if (!state) return;

    const sessionActive = state.isPlaying || state.isPaused;

    // Same button: toggle pause/resume
    if (sessionActive && state.currentAction === action) {
      if (state.isPaused) {
        resume();
      } else {
        pause();
      }
      return;
    }

    const card = state.activeCard;
    if (!card || !card.config) return;

    // Play selection
    if (action === "play-selection") {
      const selText = extractSelectedText();
      if (!selText) {
        setStatus(
          "No text selected. Select part of the question/explanation first."
        );
        return;
      }
      state.currentAction = action;
      speak(selText);
      return;
    }

    const cfg = card.config;
    let getter = null;
    if (action === "play-question-expl") {
      getter = cfg.getTextWithExplanation || cfg.getText;
    } else {
      getter = cfg.getText;
    }

    const text = safeCall(getter);
    if (!text) {
      if (action === "play-question-expl") {
        setStatus("Could not detect explanation text.");
      } else {
        setStatus("Could not detect question and answers.");
      }
      return;
    }

    state.currentAction = action;
    speak(text);
  }

  function speak(rawText) {
    if (!state) return;

    const cleaned = normalizeWhitespace(rawText);
    if (!cleaned) {
      setStatus("Nothing to read.");
      return;
    }
    if (!state.activeCard) return;

    state.currentText = cleaned;
    chooseInitialMode(true);

    if (state.ttsMode === "none") {
      setStatus(
        "No system voices available and no Google TTS key configured. The reader cannot speak."
      );
      updateToolbarButtonsForActiveCard();
      return;
    }

    // Reset previous run but keep selected mode & action
    stop(true);

    if (highlight && highlight.prepareHighlightWords) {
      highlight.prepareHighlightWords();
    }

    if (state.ttsMode === "webspeech" && ttsWeb && ttsWeb.speakWithWebSpeech) {
      ttsWeb.speakWithWebSpeech(cleaned, {
        setStatus,
        updateToolbarButtonsForActiveCard
      });
    } else if (
      state.ttsMode === "google" &&
      ttsGoogle &&
      ttsGoogle.speakWithGoogleTTS
    ) {
      ttsGoogle.speakWithGoogleTTS(cleaned, {
        setStatus,
        updateToolbarButtonsForActiveCard
      });
    } else {
      setStatus("No TTS mode available.");
      updateToolbarButtonsForActiveCard();
    }
  }

  function pause() {
    if (!state || !state.isPlaying || state.isPaused) return;

    if (state.ttsMode === "webspeech" && synth && synth.speaking) {
      synth.pause();
      state.isPaused = true;
      if (highlight && highlight.stopHighlightTimer) {
        highlight.stopHighlightTimer(false);
      }
      setStatus("Paused (browser voice).");
    } else if (state.ttsMode === "google" && state.currentAudio) {
      try {
        state.currentAudio.pause();
      } catch (_) {}
      state.isPaused = true;
      if (highlight && highlight.stopHighlightTimer) {
        highlight.stopHighlightTimer(false);
      }
      setStatus("Paused (Google TTS).");
    }

    updateToolbarButtonsForActiveCard();
  }

  function resume() {
    if (!state || !state.isPaused) return;

    if (state.ttsMode === "webspeech" && synth) {
      state.isPaused = false;
      synth.resume();
      if (highlight && highlight.startHighlightTimer) {
        highlight.startHighlightTimer(true);
      }
      setStatus("Resuming (browser voice)...");
      updateToolbarButtonsForActiveCard();
    } else if (state.ttsMode === "google" && state.currentAudio) {
      state.isPaused = false;
      state.isPlaying = true;
      state.currentAudio
        .play()
        .then(() => {
          if (highlight && highlight.startHighlightTimer) {
            highlight.startHighlightTimer(true);
          }
          setStatus("Resuming (Google TTS)...");
        })
        .catch((err) => {
          log("QuizReader", "Resume play error", err);
          setStatus("Could not resume audio: " + err.message);
        });
      updateToolbarButtonsForActiveCard();
    }
  }

  function stop(keepMode) {
    if (!state) return;

    if (synth) {
      try {
        synth.cancel();
      } catch (_) {}
    }
    if (state.currentAudio) {
      try {
        state.currentAudio.pause();
      } catch (_) {}
      state.currentAudio = null;
    }

    state.isPlaying = false;
    state.isPaused = false;
    state.currentUtterance = null;

    if (highlight && highlight.stopHighlightTimer) {
      highlight.stopHighlightTimer(true);
    }

    if (!keepMode) {
      state.ttsMode = "auto";
      state.currentAction = null;
    }

    setStatus("Stopped.");
    updateToolbarButtonsForActiveCard();
  }

  function mount(wrapper, config) {
    initOnce();
    if (!wrapper || !config || !state) return;

    const toolbarEl = wrapper.querySelector(".cz-tts-toolbar");
    const statusEl = wrapper.querySelector(".cz-tts-status");
    if (!toolbarEl || !statusEl) return;

    if (collapseState.collapsed) {
      wrapper.classList.add("cz-tts-collapsed");
    }

    toolbarEl.addEventListener("click", (evt) => {
      const btn = evt.target.closest("button.cz-tts-btn");
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === "toggle-collapse") {
        collapseState.collapsed = !collapseState.collapsed;
        applyCollapseStateToAllWrappers();
        return;
      }

      state.activeCard = { wrapper, statusEl, config };

      if (PLAY_ACTIONS.includes(action)) {
        handlePlayButtonClick(action);
      } else if (action === "stop") {
        if (!state.isPlaying && !state.isPaused) return;
        stop();
      }
    });

    const collapseBtn = toolbarEl.querySelector(
      "button.cz-tts-btn[data-action='toggle-collapse']"
    );
    if (collapseBtn) {
      collapseBtn.textContent = collapseState.collapsed ? "▸ Show all" : "▾ Hide all";
    }
  }

  const quizReader = { mount };

  window.czFeatures = window.czFeatures || {};
  window.czFeatures.quizReader = quizReader;
})();
