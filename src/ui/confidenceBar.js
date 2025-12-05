// /src/ui/confidenceBar.js
// UC2 – Confidence capture bar

(function () {
  if (window.czUI && window.czUI.confidenceBar) return;

  const log = (window.czCore && window.czCore.log) || (() => {});

  function normalizeConfidence(value) {
    if (!value) return null;
    const v = String(value).toLowerCase();
    if (v === "sure" || v === "unsure" || v === "guess") return v;
    return null;
  }

  function renderBar(host, attemptId, questionId, initialConfidence) {
    if (!host) return null;
    host.innerHTML = "";

    const bar = document.createElement("div");
    bar.className = "cz-confidence-bar";
    bar.dataset.attemptId = attemptId;
    bar.dataset.questionId = questionId || "";

    bar.innerHTML = `
      <span class="cz-confidence-label">How confident were you?</span>
      <div class="cz-confidence-buttons">
        <button type="button" class="cz-confidence-btn" data-confidence="sure">Sure</button>
        <button type="button" class="cz-confidence-btn" data-confidence="unsure">Unsure</button>
        <button type="button" class="cz-confidence-btn" data-confidence="guess">Guess</button>
      </div>
      <span class="cz-confidence-saved" aria-live="polite" hidden>Saved</span>
    `;

    host.appendChild(bar);
    updateSelectedState(bar, initialConfidence);
    return bar;
  }

  function updateSelectedState(bar, confidence) {
    if (!bar) return;
    const norm = normalizeConfidence(confidence);
    const buttons = bar.querySelectorAll(".cz-confidence-btn");
    buttons.forEach((btn) => {
      const btnConf = btn.dataset.confidence;
      if (btnConf === norm) {
        btn.classList.add("cz-confidence-selected");
        btn.setAttribute("aria-pressed", "true");
      } else {
        btn.classList.remove("cz-confidence-selected");
        btn.setAttribute("aria-pressed", "false");
      }
    });

    const saved = bar.querySelector(".cz-confidence-saved");
    if (saved) {
      if (norm) {
        saved.hidden = false;
      } else {
        saved.hidden = true;
      }
    }
  }

  function sendConfidenceToBackground(attemptId, questionId, confidence, cb) {
    if (!chrome?.runtime?.sendMessage) {
      cb && cb({ ok: false, error: "NO_RUNTIME" });
      return;
    }

    try {
      chrome.runtime.sendMessage(
        {
          type: "CZ_SET_CONFIDENCE",
          attemptId,
          questionId: questionId || null,
          confidence
        },
        (resp) => {
          if (chrome.runtime.lastError) {
            cb && cb({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          cb && cb(resp);
        }
      );
    } catch (e) {
      log("ConfidenceBar", "sendConfidenceToBackground error", e);
      cb && cb({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  }

  function mount(container, options) {
    if (!container || !options || !options.attemptId) return;

    const attemptId = String(options.attemptId);
    const questionId = options.questionId ? String(options.questionId) : "";
    const initialConfidence = normalizeConfidence(options.confidence);

    let host = container.querySelector(".cz-confidence-container");
    if (!host) {
      host = document.createElement("div");
      host.className = "cz-confidence-container";
      container.appendChild(host);
    }

    const bar = renderBar(host, attemptId, questionId, initialConfidence);
    if (!bar) return;

    if (bar.dataset.czHandlersAttached !== "1") {
      bar.dataset.czHandlersAttached = "1";
      bar.addEventListener("click", (evt) => {
        const btn = evt.target.closest(".cz-confidence-btn");
        if (!btn) return;

        const conf = normalizeConfidence(btn.dataset.confidence);
        if (!conf) return;

        updateSelectedState(bar, conf);
        sendConfidenceToBackground(attemptId, questionId, conf, (resp) => {
          if (!resp || !resp.ok) {
            log(
              "ConfidenceBar",
              "Background update failed",
              resp && resp.error
            );
            return;
          }
          updateSelectedState(bar, conf);
        });
      });
    }
  }

  window.czUI = window.czUI || {};
  window.czUI.confidenceBar = { mount };
})();
