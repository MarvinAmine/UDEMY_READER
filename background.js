// background.js
// Currently unused, kept for future chrome.tts experiments.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "CZ_TTS_SPEAK") {
    const text = (msg.text || "").trim();
    if (!text) {
      sendResponse({ ok: false, error: "EMPTY_TEXT" });
      return;
    }

    chrome.tts.stop();

    chrome.tts.speak(text, {
      lang: msg.lang || "en-US",
      rate: msg.rate || 1.0,
      pitch: msg.pitch || 1.0,
      onEvent: (event) => {
        if (event.type === "error") {
          console.warn("[UdemyReader background] TTS error:", event.error);
        }
      }
    });

    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "CZ_TTS_STOP") {
    chrome.tts.stop();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "CZ_TTS_PAUSE") {
    if (chrome.tts.pause) {
      chrome.tts.pause();
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "CZ_TTS_RESUME") {
    if (chrome.tts.resume) {
      chrome.tts.resume();
    }
    sendResponse({ ok: true });
    return true;
  }
});
