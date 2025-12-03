// /src/engines/ttsEngineWeb.js
(function () {
  window.czEngines = window.czEngines || {};
  if (window.czEngines.ttsWeb) return;

  const synth = window.speechSynthesis || null;
  const state = (window.czCore && window.czCore.state) || null;
  const log = (window.czCore && window.czCore.log) || (() => {});
  const highlight =
    (window.czEngines && window.czEngines.highlight) || null;

  function speakWithWebSpeech(text, helpers) {
    const setStatus = helpers && helpers.setStatus
      ? helpers.setStatus
      : function () {};
    const updateToolbarButtonsForActiveCard =
      helpers && helpers.updateToolbarButtonsForActiveCard
        ? helpers.updateToolbarButtonsForActiveCard
        : function () {};

    if (!synth) {
      setStatus("Web Speech API not available in this browser.");
      updateToolbarButtonsForActiveCard();
      return;
    }
    if (!state || !state.hasWebVoices) {
      setStatus(
        "No system voices available for text-to-speech (Web Speech API)."
      );
      updateToolbarButtonsForActiveCard();
      return;
    }

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";

    state.currentUtterance = utter;
    state.isPlaying = true;
    state.isPaused = false;

    setStatus("Reading with browser voice…");
    if (highlight && highlight.startHighlightTimer) {
      highlight.startHighlightTimer(false);
    }
    updateToolbarButtonsForActiveCard();

    utter.onend = () => {
      state.isPlaying = false;
      state.isPaused = false;
      state.currentAction = null;
      if (highlight && highlight.stopHighlightTimer) {
        highlight.stopHighlightTimer(true);
      }
      setStatus("Finished.");
      updateToolbarButtonsForActiveCard();
    };

    utter.onerror = (e) => {
      log("WebTTS", "Speech synthesis error", e);
      state.isPlaying = false;
      state.isPaused = false;
      state.currentAction = null;
      if (highlight && highlight.stopHighlightTimer) {
        highlight.stopHighlightTimer(true);
      }
      setStatus(
        "Speech error (Web Speech). Falling back to Google TTS if available."
      );
      updateToolbarButtonsForActiveCard();
    };

    try {
      synth.speak(utter);
    } catch (e) {
      log("WebTTS", "speak() threw", e);
      state.isPlaying = false;
      state.isPaused = false;
      state.currentAction = null;
      if (highlight && highlight.stopHighlightTimer) {
        highlight.stopHighlightTimer(true);
      }
      setStatus("Speech error (Web Speech).");
      updateToolbarButtonsForActiveCard();
    }
  }

  window.czEngines.ttsWeb = {
    speakWithWebSpeech
  };
})();
