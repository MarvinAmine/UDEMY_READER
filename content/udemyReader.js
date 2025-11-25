// content/udemyReader.js
// Udemy Quiz Reader – inline toolbar + Google TTS + word highlighting

(() => {
  if (window.__czUdemyReaderInjected) return;
  window.__czUdemyReaderInjected = true;

  /********************************************************************
   * STATE
   ********************************************************************/

  const synth = window.speechSynthesis || null;

  const state = {
    ttsMode: "auto", // "auto" | "webspeech" | "google" | "none"
    hasWebVoices: false,
    googleApiKey: "",

    isPlaying: false,
    isPaused: false,
    currentText: "",
    currentUtterance: null, // WebSpeech
    currentAudio: null,     // Google TTS HTMLAudioElement

    highlight: {
      words: [],
      index: -1,
      timerId: null,
      intervalMs: 250
    },

    elements: {
      wrapper: null,
      status: null
    }
  };

  function log(...args) {
    console.log("[UdemyReader]", ...args);
  }

  /********************************************************************
   * INIT
   ********************************************************************/

  // initial best-effort load of the key (popup will keep storage up to date)
  function initialLoadGoogleKey() {
    if (!chrome?.storage?.sync) {
      log("chrome.storage.sync not available");
      return;
    }
    chrome.storage.sync.get(["czGoogleTtsKey"], (res) => {
      state.googleApiKey = (res.czGoogleTtsKey || "").trim();
      log(
        "Initial Google TTS key from storage:",
        state.googleApiKey ? "present" : "empty"
      );
    });
  }

  function initOnceQuestionExists() {
    const questionForm = getQuestionForm();
    if (!questionForm) return;

    if (questionForm.querySelector("#cz-tts-wrapper")) return;
    injectReader(questionForm);
  }

  function getQuestionForm() {
    return document.querySelector(
      'form.mc-quiz-question--container--dV-tK[data-testid="mc-quiz-question"]'
    );
  }

  function injectReader(questionForm) {
    const wrapper = document.createElement("div");
    wrapper.id = "cz-tts-wrapper";
    wrapper.className = "cz-tts-wrapper";

    wrapper.innerHTML = `
      <div class="cz-tts-toolbar">
        <span class="cz-tts-title">Quiz Reader</span>
        <button type="button" class="cz-tts-btn" data-action="play-question">
          ▶ Play Q + answers
        </button>
        <button type="button" class="cz-tts-btn" data-action="play-selection">
          ▶ Play selection
        </button>
        <button type="button" class="cz-tts-btn" data-action="pause">
          ⏸ Pause
        </button>
        <button type="button" class="cz-tts-btn" data-action="resume">
          ⏯ Resume
        </button>
        <button type="button" class="cz-tts-btn" data-action="stop">
          ⏹ Stop
        </button>
      </div>
      <div id="cz-tts-status" class="cz-tts-status">
        Ready. Use “Play Q + answers” or select some text and use “Play selection”.
      </div>
    `;

    const promptDiv = questionForm.querySelector("#question-prompt");
    if (promptDiv && promptDiv.parentNode === questionForm) {
      promptDiv.insertAdjacentElement("afterend", wrapper);
    } else {
      questionForm.appendChild(wrapper);
    }

    state.elements.wrapper = wrapper;
    state.elements.status = wrapper.querySelector("#cz-tts-status");

    hookToolbarEvents(wrapper);
    initVoices();
    initialLoadGoogleKey();
  }

  function hookToolbarEvents(wrapper) {
    wrapper.addEventListener("click", (evt) => {
      const btn = evt.target.closest("button.cz-tts-btn");
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === "play-question") {
        const text = extractUdemyQuestionAndChoicesText();
        if (!text) {
          setStatus(
            "Could not detect question and answers. Are you on a Udemy quiz question?"
          );
          return;
        }
        speakText(text);
      } else if (action === "play-selection") {
        const text = extractSelectedText();
        if (!text) {
          setStatus("No text selected. Select part of the question/explanation first.");
          return;
        }
        speakText(text);
      } else if (action === "pause") {
        pauseReading();
      } else if (action === "resume") {
        resumeReading();
      } else if (action === "stop") {
        stopReading();
      }
    });
  }

  function setStatus(msg) {
    if (state.elements.status) {
      state.elements.status.textContent = msg;
    }
  }

  /********************************************************************
   * TEXT EXTRACTION + WORD WRAPPING
   ********************************************************************/

  function extractUdemyQuestionAndChoicesText() {
    const form = getQuestionForm();
    if (!form) return "";

    const promptEl = form.querySelector(".mc-quiz-question--question-prompt--9cMw2");
    const questionText = promptEl ? normalizeWhitespace(promptEl.innerText) : "";

    const answerEls = form.querySelectorAll(".mc-quiz-answer--answer-body--V-o8d");
    const answers = Array.from(answerEls).map((el, idx) => {
      const label = String.fromCharCode(65 + idx); // A, B, C, ...
      const text = normalizeWhitespace(el.innerText || "");
      return `${label}. ${text}`;
    });

    const combined =
      questionText + (answers.length ? "\n\n" + answers.join("\n") : "");

    log("Extracted text length:", combined.length);
    return combined;
  }

  function extractSelectedText() {
    const sel = window.getSelection();
    if (!sel) return "";
    return normalizeWhitespace(sel.toString());
  }

  function normalizeWhitespace(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  // Wrap all text nodes in question + answers into <span class="cz-tts-word">
  function ensureWordWrapping() {
    const form = getQuestionForm();
    if (!form) return;

    const targets = [];

    const prompt = form.querySelector("#question-prompt");
    if (prompt && !prompt.dataset.czTtsWrapped) targets.push(prompt);

    const answers = form.querySelectorAll(".mc-quiz-answer--answer-body--V-o8d");
    answers.forEach((el) => {
      if (!el.dataset.czTtsWrapped) targets.push(el);
    });

    targets.forEach((root) => {
      wrapTextNodes(root);
      root.dataset.czTtsWrapped = "1";
    });
  }

  function wrapTextNodes(root) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

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

  /********************************************************************
   * HIGHLIGHT MANAGEMENT
   ********************************************************************/

  function prepareHighlightWords() {
    ensureWordWrapping();

    const words = document.querySelectorAll(
      "#question-prompt .cz-tts-word, .mc-quiz-answer--answer-body--V-o8d .cz-tts-word"
    );

    state.highlight.words = Array.from(words);
    state.highlight.index = -1;

    const combinedLength = state.currentText.length || 1;
    const wordCount = Math.max(state.highlight.words.length, 1);

    // crude estimate: ~13 chars/s at rate 1.0
    const estimatedSeconds = combinedLength / 13;
    const intervalMs = (estimatedSeconds * 1000) / wordCount;

    state.highlight.intervalMs = Math.min(
      600,
      Math.max(120, Math.round(intervalMs))
    );

    log(
      "Prepared highlight words:",
      wordCount,
      "combined length:",
      combinedLength
    );
  }

  function clearHighlight() {
    state.highlight.words.forEach((w) =>
      w.classList.remove("cz-tts-word-current")
    );
  }

  function stopHighlightTimer(resetIndex = true) {
    if (state.highlight.timerId) {
      clearInterval(state.highlight.timerId);
      state.highlight.timerId = null;
    }
    clearHighlight();
    if (resetIndex) state.highlight.index = -1;
  }

  function startHighlightTimer(fromCurrent = false) {
    stopHighlightTimer(false);

    if (!state.highlight.words.length) return;

    const wordCount = state.highlight.words.length;
    let idx = fromCurrent ? state.highlight.index : -1;

    log(
      "startHighlightTimer:",
      "wordCount=" + wordCount,
      "intervalMs=" + state.highlight.intervalMs
    );

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
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }, state.highlight.intervalMs);
  }

  /********************************************************************
   * TTS MODE MANAGEMENT
   ********************************************************************/

  function initVoices() {
    if (!synth) {
      log("Web Speech API not available in this browser.");
      state.hasWebVoices = false;
      chooseInitialMode();
      return;
    }

    function updateVoices() {
      const list = synth.getVoices() || [];
      log("Initial voices count:", list.length);
      state.hasWebVoices = list.length > 0;
      if (state.hasWebVoices && state.ttsMode === "auto") {
        state.ttsMode = "webspeech";
        log("Using Web Speech API (voices available).");
      } else if (!state.hasWebVoices) {
        log("No system voices available for Web Speech API on this machine.");
        chooseInitialMode();
      }
    }

    synth.onvoiceschanged = updateVoices;
    updateVoices();
    setTimeout(() => {
      if (!state.hasWebVoices) updateVoices();
    }, 2000);
  }

  function chooseInitialMode() {
    if (state.ttsMode !== "auto") return;

    if (state.hasWebVoices) {
      state.ttsMode = "webspeech";
    } else if (state.googleApiKey) {
      state.ttsMode = "google";
      log("Falling back to Google Cloud TTS (no local voices).");
    } else {
      state.ttsMode = "none";
      log("No TTS available: no voices and no Google TTS key configured.");
      setStatus(
        "No system voices available and no Google TTS key configured. The reader cannot speak."
      );
    }
  }

  // Make sure we always have the latest key *before* choosing the mode
  function refreshGoogleKeyThen(callback) {
    if (!chrome?.storage?.sync) {
      callback();
      return;
    }
    chrome.storage.sync.get(["czGoogleTtsKey"], (res) => {
      state.googleApiKey = (res.czGoogleTtsKey || "").trim();
      log(
        "Refreshed Google TTS key from storage:",
        state.googleApiKey ? "present" : "empty"
      );
      callback();
    });
  }

  /********************************************************************
   * HIGH-LEVEL READ / PAUSE / RESUME / STOP
   ********************************************************************/

  function speakText(text) {
    const cleaned = normalizeWhitespace(text);
    if (!cleaned) {
      setStatus("Nothing to read.");
      return;
    }

    state.currentText = cleaned;

    // Re-load key before each read, then decide mode
    refreshGoogleKeyThen(() => {
      state.ttsMode = "auto"; // re-evaluate mode with latest info
      chooseInitialMode();

      if (state.ttsMode === "none") {
        return;
      }

      stopReading(true); // keep mode
      prepareHighlightWords();

      if (state.ttsMode === "webspeech") {
        speakWithWebSpeech(cleaned);
      } else if (state.ttsMode === "google") {
        speakWithGoogleTTS(cleaned);
      } else {
        setStatus("No TTS mode available.");
      }
    });
  }

  function pauseReading() {
    if (!state.isPlaying || state.isPaused) return;

    if (state.ttsMode === "webspeech" && synth && synth.speaking) {
      synth.pause();
      state.isPaused = true;
      stopHighlightTimer(false);
      setStatus("Paused (browser voice).");
    } else if (state.ttsMode === "google" && state.currentAudio) {
      state.currentAudio.pause();
      state.isPaused = true;
      stopHighlightTimer(false);
      setStatus("Paused (Google TTS).");
    }
  }

  function resumeReading() {
    if (!state.isPaused) return;

    if (state.ttsMode === "webspeech" && synth) {
      synth.resume();
      state.isPaused = false;
      startHighlightTimer(true);
      setStatus("Resuming (browser voice)...");
    } else if (state.ttsMode === "google" && state.currentAudio) {
      state.currentAudio
        .play()
        .then(() => {
          state.isPaused = false;
          startHighlightTimer(true);
          setStatus("Resuming (Google TTS)...");
        })
        .catch((err) => {
          log("Resume play error:", err);
          setStatus("Could not resume audio: " + err.message);
        });
    }
  }

  function stopReading(keepMode = false) {
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

    stopHighlightTimer(true);

    if (!keepMode) {
      state.ttsMode = "auto";
    }

    setStatus("Stopped.");
  }

  /********************************************************************
   * WEB SPEECH IMPLEMENTATION
   ********************************************************************/

  function speakWithWebSpeech(text) {
    if (!synth) {
      setStatus("Web Speech API not available in this browser.");
      return;
    }
    if (!state.hasWebVoices) {
      setStatus("No system voices available for text-to-speech (Web Speech API).");
      return;
    }

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    state.currentUtterance = utter;
    state.isPlaying = true;
    state.isPaused = false;

    setStatus("Reading with browser voice…");
    startHighlightTimer(false);

    utter.onend = () => {
      state.isPlaying = false;
      state.isPaused = false;
      stopHighlightTimer(true);
      setStatus("Finished.");
    };

    utter.onerror = (e) => {
      log("Speech synthesis error", e);
      state.isPlaying = false;
      state.isPaused = false;
      stopHighlightTimer(true);
      setStatus("Speech error (Web Speech). Falling back to Google TTS if available.");

      if (state.googleApiKey) {
        state.ttsMode = "google";
        speakWithGoogleTTS(state.currentText || text);
      }
    };

    synth.speak(utter);
  }

  /********************************************************************
   * GOOGLE CLOUD TTS IMPLEMENTATION (NO BACKEND)
   ********************************************************************/

  async function speakWithGoogleTTS(text) {
    if (!state.googleApiKey) {
      setStatus("Google TTS not configured. Please set your API key in the popup.");
      return;
    }

    const endpoint =
      "https://texttospeech.googleapis.com/v1/text:synthesize?key=" +
      encodeURIComponent(state.googleApiKey);

    try {
      setStatus("Contacting Google Text-to-Speech…");
      log("Sending text to Google TTS, length:", text.length);

      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          input: { text },
          voice: {
            languageCode: "en-US",
            name: "en-US-Wavenet-D",
            ssmlGender: "MALE"
          },
          audioConfig: {
            audioEncoding: "MP3",
            speakingRate: 1.0,
            pitch: 0.0
          }
        })
      });

      if (!resp.ok) {
        const bodyText = await resp.text().catch(() => "");
        throw new Error(
          "HTTP " + resp.status + " " + resp.statusText + " – " + bodyText
        );
      }

      const data = await resp.json();
      if (!data.audioContent) {
        throw new Error("No audioContent in Google TTS response");
      }

      const audioSrc = "data:audio/mp3;base64," + data.audioContent;

      if (state.currentAudio) {
        try {
          state.currentAudio.pause();
        } catch (_) {}
      }

      const audio = new Audio(audioSrc);
      state.currentAudio = audio;
      state.isPlaying = true;
      state.isPaused = false;

      audio.onended = () => {
        state.isPlaying = false;
        state.isPaused = false;
        stopHighlightTimer(true);
        setStatus("Finished.");
      };

      audio.onerror = (err) => {
        log("Audio playback error", err);
        state.isPlaying = false;
        state.isPaused = false;
        stopHighlightTimer(true);
        setStatus("Audio playback error: " + (err?.message || "Unknown error"));
      };

      startHighlightTimer(false);
      await audio.play();
      setStatus("Reading with Google Text-to-Speech…");
    } catch (err) {
      log("Google TTS failed", err);
      state.isPlaying = false;
      state.isPaused = false;
      stopHighlightTimer(true);
      setStatus("Google TTS error: " + err.message);
    }
  }

  /********************************************************************
   * MUTATION OBSERVER – HANDLE QUESTION CHANGES
   ********************************************************************/

  function setupObserver() {
    const target = document.querySelector(".quiz-page-content") || document.body;
    const obs = new MutationObserver(() => {
      initOnceQuestionExists();
    });

    obs.observe(target, { childList: true, subtree: true });
  }

  // Initial run
  initOnceQuestionExists();
  setupObserver();
})();
