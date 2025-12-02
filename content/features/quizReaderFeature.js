// content/features/quizReaderFeature.js
// Shared Quiz Reader feature (TTS + word highlighting)
// Location scripts (practiceMode / reviewMode) mount this per question/card.

(function () {
  if (window.czFeatures && window.czFeatures.quizReader) return;

  const synth = window.speechSynthesis || null;

  const state = {
    initialized: false,
    ttsMode: "auto",       // "auto" | "webspeech" | "google" | "none"
    hasWebVoices: false,
    googleApiKey: "",

    isPlaying: false,
    isPaused: false,
    currentText: "",
    currentUtterance: null,
    currentAudio: null,

    activeCard: null,      // { wrapper, statusEl, config }

    highlight: {
      words: [],
      index: -1,
      timerId: null,
      intervalMs: 250
    }
  };

  // Keep a safety margin under the official 5000-byte limit
  const GOOGLE_TTS_MAX_BYTES = 4800;

  function log(...args) {
    console.log("[UdemyReader][QuizReader]", ...args);
  }

  /* -------------------------------------------------------------
   * INIT
   * ------------------------------------------------------------- */

  function initOnce() {
    if (state.initialized) return;
    state.initialized = true;
    loadGoogleKey();
    initVoices();
  }

  function loadGoogleKey() {
    if (!chrome?.storage?.sync) {
      log("chrome.storage.sync not available");
      return;
    }
    chrome.storage.sync.get(["czGoogleTtsKey"], (res) => {
      state.googleApiKey = (res.czGoogleTtsKey || "").trim();
      log(
        "Loaded Google TTS key from storage:",
        state.googleApiKey ? "present" : "empty"
      );

      // NEW: re-evaluate mode now that we know if we have a TTS key
      chooseInitialMode(true);
    });
  }


  function initVoices() {
    if (!synth) {
      log("Web Speech API not available.");
      state.hasWebVoices = false;
      chooseInitialMode();
      return;
    }

    function updateVoices() {
      const list = synth.getVoices() || [];
      state.hasWebVoices = list.length > 0;
      log("Voices count:", list.length);
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

  function chooseInitialMode(force = false) {
    // Allow recalculation if:
    // - we are still in "auto" (first time)
    // - we previously had "none" (no available TTS yet), or
    // - we explicitly force a recalculation (force === true)
    if (
      !force &&
      state.ttsMode !== "auto" &&
      state.ttsMode !== "none"
    ) {
      return;
    }

    if (state.hasWebVoices) {
      state.ttsMode = "webspeech";
    } else if (state.googleApiKey) {
      state.ttsMode = "google";
      log("Using Google Cloud TTS (no local voices).");
    } else {
      state.ttsMode = "none";
      setStatus(
        "No system voices available and no Google TTS key configured. The reader cannot speak."
      );
    }
  }


  /* -------------------------------------------------------------
   * PUBLIC: mount
   * ------------------------------------------------------------- */

  // wrapper: card element containing toolbar + status
  // config: {
  //   getText: () => string,
  //   getHighlightRoots: () => HTMLElement[]
  // }
  function mount(wrapper, config) {
    initOnce();

    if (!wrapper || !config) return;

    const toolbar = wrapper.querySelector(".cz-tts-toolbar");
    const statusEl = wrapper.querySelector(".cz-tts-status");

    if (!toolbar || !statusEl) return;

    toolbar.addEventListener("click", (evt) => {
      const btn = evt.target.closest("button.cz-tts-btn");
      if (!btn) return;
      const action = btn.dataset.action;

      state.activeCard = { wrapper, statusEl, config };

      if (action === "play-question") {
        const text = safeCall(config.getText);
        if (!text) {
          setStatus("Could not detect question and answers.");
          return;
        }
        speak(text);
      } else if (action === "play-selection") {
        const selText = extractSelectedText();
        if (!selText) {
          setStatus("No text selected. Select part of the question/explanation first.");
          return;
        }
        speak(selText);
      } else if (action === "pause") {
        pause();
      } else if (action === "resume") {
        resume();
      } else if (action === "stop") {
        stop();
      }
    });
  }

  /* -------------------------------------------------------------
   * TEXT + HIGHLIGHT
   * ------------------------------------------------------------- */

  function safeCall(fn) {
    try {
      return fn ? fn() : "";
    } catch (e) {
      log("config fn error", e);
      return "";
    }
  }

  function extractSelectedText() {
    const sel = window.getSelection();
    if (!sel) return "";
    return normalizeWhitespace(sel.toString());
  }

  function normalizeWhitespace(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function prepareHighlightWords() {
    const card = state.activeCard;
    if (!card || !card.config || typeof card.config.getHighlightRoots !== "function") {
      state.highlight.words = [];
      return;
    }

    const roots = card.config.getHighlightRoots() || [];
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

    const combinedLength = state.currentText.length || 1;
    const wordCount = Math.max(words.length, 1);
    const estimatedSeconds = combinedLength / 13; // ~13 chars/s
    const intervalMs = (estimatedSeconds * 1000) / wordCount;

    state.highlight.intervalMs = Math.min(
      600,
      Math.max(120, Math.round(intervalMs))
    );

    log("Highlight words prepared:", wordCount, "combined length:", combinedLength);
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

  function clearHighlight() {
    state.highlight.words.forEach((w) => w.classList.remove("cz-tts-word-current"));
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

  /* -------------------------------------------------------------
   * STATUS
   * ------------------------------------------------------------- */

  function setStatus(msg) {
    const card = state.activeCard;
    if (!card || !card.statusEl) return;
    card.statusEl.textContent = msg;
  }

  /* -------------------------------------------------------------
   * HIGH-LEVEL CONTROLS
   * ------------------------------------------------------------- */

  function speak(rawText) {
    const cleaned = normalizeWhitespace(rawText);
    if (!cleaned) {
      setStatus("Nothing to read.");
      return;
    }
    if (!state.activeCard) return;

    state.currentText = cleaned;

    // NEW: force re-check of mode in case voices/key became available
    chooseInitialMode(true);
    if (state.ttsMode === "none") {
      // Make it clear why nothing is playing instead of silently failing
      setStatus(
        "No system voices available and no Google TTS key configured. The reader cannot speak."
      );
      return;
    }

    stop(true);             // keep mode
    prepareHighlightWords();

    if (state.ttsMode === "webspeech") {
      speakWithWebSpeech(cleaned);
    } else if (state.ttsMode === "google") {
      speakWithGoogleTTS(cleaned);
    } else {
      setStatus("No TTS mode available.");
    }
  }


  function pause() {
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

  function resume() {
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
          log("Resume play error", err);
          setStatus("Could not resume audio: " + err.message);
        });
    }
  }

  function stop(keepMode = false) {
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

  /* -------------------------------------------------------------
   * WEB SPEECH
   * ------------------------------------------------------------- */

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

  /* -------------------------------------------------------------
   * GOOGLE CLOUD TTS (direct from content script)
   * ------------------------------------------------------------- */

  // Split a string into chunks that are each <= maxBytes in UTF-8.
  function splitTextIntoChunksByBytes(text, maxBytes) {
    if (!text) return [];

    // Fallback if TextEncoder is not available (older browsers)
    if (typeof TextEncoder === "undefined") {
      const approxChars = Math.floor(maxBytes * 0.9);
      const chunks = [];
      for (let i = 0; i < text.length; i += approxChars) {
        chunks.push(text.slice(i, i + approxChars));
      }
      return chunks;
    }

    const encoder = new TextEncoder();
    const chunks = [];
    let current = "";
    let currentBytes = 0;

    for (const ch of text) {
      const byteLength = encoder.encode(ch).length;
      if (currentBytes + byteLength > maxBytes) {
        if (current) chunks.push(current);
        current = ch;
        currentBytes = byteLength;
      } else {
        current += ch;
        currentBytes += byteLength;
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }

  async function speakWithGoogleTTS(text) {
    if (!state.googleApiKey) {
      setStatus("Google TTS not configured. Please set your API key in the popup.");
      return;
    }

    const endpoint =
      "https://texttospeech.googleapis.com/v1/text:synthesize?key=" +
      encodeURIComponent(state.googleApiKey);

    // Prepare chunks so each request stays under the 5000-byte limit.
    const chunks = splitTextIntoChunksByBytes(text, GOOGLE_TTS_MAX_BYTES);
    if (!chunks.length) {
      setStatus("Nothing to read.");
      return;
    }

    log(
      "Sending text to Google TTS in",
      chunks.length,
      "chunk(s). Total length:",
      text.length
    );

    // Mark as playing once for the whole sequence
    state.isPlaying = true;
    state.isPaused = false;

    let chunkIndex = 0;

    const playNextChunk = async () => {
      // If the user stopped playback, don't continue.
      if (!state.isPlaying) return;

      if (chunkIndex >= chunks.length) {
        // All chunks done
        state.isPlaying = false;
        state.isPaused = false;
        stopHighlightTimer(true);
        setStatus("Finished.");
        return;
      }

      const chunkText = chunks[chunkIndex];
      const thisChunkNumber = chunkIndex + 1;
      const totalChunks = chunks.length;
      chunkIndex += 1;

      try {
        setStatus(
          totalChunks > 1
            ? `Contacting Google Text-to-Speech… (${thisChunkNumber}/${totalChunks})`
            : "Contacting Google Text-to-Speech…"
        );

        const resp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: { text: chunkText },
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

        // Start highlighting only once, on the first chunk.
        if (!state.highlight.timerId) {
          startHighlightTimer(false);
        }

        audio.onended = () => {
          // Only move to next chunk if we are still in "playing" state.
          if (!state.isPlaying) return;
          playNextChunk();
        };

        audio.onerror = (err) => {
          log("Audio playback error", err);
          state.isPlaying = false;
          state.isPaused = false;
          stopHighlightTimer(true);
          setStatus("Audio playback error: " + (err?.message || "Unknown error"));
        };

        await audio.play();
        setStatus(
          totalChunks > 1
            ? `Reading with Google Text-to-Speech… (${thisChunkNumber}/${totalChunks})`
            : "Reading with Google Text-to-Speech…"
        );
      } catch (err) {
        log("Google TTS failed", err);
        state.isPlaying = false;
        state.isPaused = false;
        stopHighlightTimer(true);
        setStatus("Google TTS error: " + err.message);
      }
    };

    // Kick off the first chunk (rest is chained via onended)
    playNextChunk();
  }

  /* -------------------------------------------------------------
   * EXPORT
   * ------------------------------------------------------------- */

  const quizReader = { mount };

  window.czFeatures = window.czFeatures || {};
  window.czFeatures.quizReader = quizReader;
})();
