// /src/engines/ttsEngineGoogle.js
(function () {
  window.czEngines = window.czEngines || {};
  if (window.czEngines.ttsGoogle) return;

  const state = (window.czCore && window.czCore.state) || null;
  const log = (window.czCore && window.czCore.log) || (() => {});
  const highlight =
    (window.czEngines && window.czEngines.highlight) || null;

  const GOOGLE_TTS_MAX_BYTES = 4800;

  function splitTextIntoChunksByBytes(text, maxBytes) {
    if (!text) return [];

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

  async function speakWithGoogleTTS(text, helpers) {
    const setStatus = helpers && helpers.setStatus
      ? helpers.setStatus
      : function () {};
    const updateToolbarButtonsForActiveCard =
      helpers && helpers.updateToolbarButtonsForActiveCard
        ? helpers.updateToolbarButtonsForActiveCard
        : function () {};

    if (!state) {
      setStatus("Internal error: no state available.");
      updateToolbarButtonsForActiveCard();
      return;
    }

    if (!state.googleApiKey) {
      setStatus(
        "Google TTS not configured. Please set your API key in the popup."
      );
      updateToolbarButtonsForActiveCard();
      return;
    }

    const endpoint =
      "https://texttospeech.googleapis.com/v1/text:synthesize?key=" +
      encodeURIComponent(state.googleApiKey);

    const chunks = splitTextIntoChunksByBytes(text, GOOGLE_TTS_MAX_BYTES);
    if (!chunks.length) {
      setStatus("Nothing to read.");
      updateToolbarButtonsForActiveCard();
      return;
    }

    log(
      "GoogleTTS",
      "Sending text to Google TTS in",
      chunks.length,
      "chunk(s). Total length:",
      text.length
    );

    state.isPlaying = true;
    state.isPaused = false;
    updateToolbarButtonsForActiveCard();

    let chunkIndex = 0;
    let highlightStarted = false;
    let highlightIntervalLocked = false;

    const playNextChunk = async () => {
      if (!state.isPlaying) return;
      if (chunkIndex >= chunks.length) {
        state.isPlaying = false;
        state.isPaused = false;
        state.currentAction = null;
        if (highlight && highlight.stopHighlightTimer) {
          highlight.stopHighlightTimer(true);
        }
        setStatus("Finished.");
        updateToolbarButtonsForActiveCard();
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
            "HTTP " +
              resp.status +
              " " +
              resp.statusText +
              " – " +
              bodyText
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

        if (!highlightIntervalLocked && audio.addEventListener) {
          audio.addEventListener("loadedmetadata", () => {
            try {
              const totalDuration = audio.duration;
              if (isFinite(totalDuration) && totalDuration > 0) {
                const wordCount = Math.max(
                  state.highlight.words.length,
                  1
                );
                const intervalMs =
                  (totalDuration * 1000) / wordCount;
                state.highlight.intervalMs = Math.min(
                  600,
                  Math.max(120, Math.round(intervalMs))
                );
                log(
                  "GoogleTTS",
                  "Highlight interval adjusted from audio duration:",
                  totalDuration,
                  "sec =>",
                  state.highlight.intervalMs,
                  "ms per word"
                );
                highlightIntervalLocked = true;
              }
            } catch (e) {
              log("GoogleTTS", "Error computing interval from metadata", e);
            }
          });
        }

        if (audio.addEventListener) {
          audio.addEventListener("play", () => {
            if (!highlightStarted) {
              highlightStarted = true;
              if (highlight && highlight.startHighlightTimer) {
                highlight.startHighlightTimer(false);
              }
            }
          });
        }

        audio.onended = () => {
          if (!state.isPlaying) return;
          playNextChunk();
        };

        audio.onerror = (err) => {
          log("GoogleTTS", "Audio playback error", err);
          state.isPlaying = false;
          state.isPaused = false;
          state.currentAction = null;
          if (highlight && highlight.stopHighlightTimer) {
            highlight.stopHighlightTimer(true);
          }
          setStatus(
            "Audio playback error: " + (err && err.message
              ? err.message
              : "Unknown error")
          );
          updateToolbarButtonsForActiveCard();
        };

        await audio.play();
        setStatus(
          totalChunks > 1
            ? `Reading with Google Text-to-Speech… (${thisChunkNumber}/${totalChunks})`
            : "Reading with Google Text-to-Speech…"
        );
        updateToolbarButtonsForActiveCard();
      } catch (err) {
        log("GoogleTTS", "Google TTS failed", err);
        state.isPlaying = false;
        state.isPaused = false;
        state.currentAction = null;
        if (highlight && highlight.stopHighlightTimer) {
          highlight.stopHighlightTimer(true);
        }
        setStatus("Google TTS error: " + err.message);
        updateToolbarButtonsForActiveCard();
      }
    };

    playNextChunk();
  }

  window.czEngines.ttsGoogle = {
    speakWithGoogleTTS
  };
})();
