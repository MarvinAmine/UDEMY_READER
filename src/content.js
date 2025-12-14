// /src/content.js
// Question Insight feature wiring (LLM analysis -> Analysis Panel)

(function () {
  if (!window) return;
  if (!window.czFeatures) window.czFeatures = {};
  if (window.czFeatures.questionInsight) return;

  const log = (window.czCore && window.czCore.log) || (() => {});
  const analysis = window.czEngines && window.czEngines.analysis;
  const analysisPanel =
    window.czUI && window.czUI.analysisPanel;

  function safeCall(fn) {
    try {
      return fn ? fn() : "";
    } catch (e) {
      log("QuestionInsight", "config fn error", e);
      return "";
    }
  }

  function setBodyHtml(bodyEl, html) {
    bodyEl.innerHTML = html;
  }

  function setAnalyzedLabel(analysisRoot, hasAnalysis) {
    if (!analysisRoot) return;
    analysisRoot.dataset.czAnalyzed = hasAnalysis ? "1" : "0";
    const btn = analysisRoot.querySelector(
      "button.cz-tts-btn[data-action='analyze-question']"
    );
    if (!btn) return;
    btn.textContent = hasAnalysis
      ? "↻ Re-analyze question"
      : "🧠 Analyze question";
  }

  function checkIfFirstAnalysis(questionId, cb) {
    if (!questionId || !chrome?.storage?.local) {
      cb && cb(false);
      return;
    }

    try {
      chrome.storage.local.get(["czQuestionMeta"], (res) => {
        const meta = res.czQuestionMeta || {};
        const entry = meta[String(questionId)];
        const isFirst =
          !entry || !entry.lastAnalysisAt || entry.lastAnalysisAt === 0;
        cb && cb(isFirst);
      });
    } catch (e) {
      cb && cb(false);
    }
  }

  function insertFirstAnalysisDisclaimer(bodyEl) {
    if (!bodyEl) return;
    if (bodyEl.querySelector(".cz-tts-analysis-disclaimer")) return;
    const note = document.createElement("div");
    note.className = "cz-tts-analysis-disclaimer";
    note.textContent =
      "LLM answers can be wrong. Always re-verify responses first.";
    bodyEl.appendChild(note);
  }

  function analyzeQuestion(
    text,
    questionId,
    bodyEl,
    config,
    analysisRoot
  ) {
    const trimmed = (text || "").trim();
    const explanationText = safeCall(config.getExplanationText);
    const combinedText =
      explanationText && String(explanationText).trim().length
        ? trimmed +
          "\n\nOfficial explanation:\n" +
          String(explanationText).trim()
        : trimmed;
    if (!trimmed) {
      setBodyHtml(
        bodyEl,
        "<em>Could not detect question text. Are you on a Udemy exam question?</em>"
      );
      return;
    }

    if (!chrome?.runtime?.sendMessage) {
      setBodyHtml(bodyEl, "<em>Chrome runtime messaging not available.</em>");
      return;
    }

    setBodyHtml(bodyEl, "<em>Analyzing question with AI…</em>");

    try {
      chrome.runtime.sendMessage(
        {
          type: "CZ_ANALYZE_QUESTION",
          text: combinedText,
          questionId: questionId || null
        },
        (resp) => {
          if (chrome.runtime.lastError) {
            const msg =
              chrome.runtime.lastError.message || "Unknown error";
            const escapeHtml =
              analysis && analysis.escapeHtml
                ? analysis.escapeHtml
                : (x) => String(x);
            setBodyHtml(
              bodyEl,
              `<em>Extension error: ${escapeHtml(
                msg
              )}</em><br><small>If you just reloaded the extension, reload the Udemy tab and try again.</small>`
            );
            return;
          }

          if (!resp || !resp.ok) {
            const msg =
              resp && resp.error
                ? resp.error
                : "Unknown error from analysis background.";
            const escapeHtml =
              analysis && analysis.escapeHtml
                ? analysis.escapeHtml
                : (x) => String(x);
            setBodyHtml(
              bodyEl,
              `<em>Analysis failed: ${escapeHtml(
                String(msg)
              )}</em><br><small>Check your LLM API key in the extension popup.</small>`
            );
            return;
          }

          const anay = resp.analysis || {};
          if (analysisRoot) {
            setAnalyzedLabel(analysisRoot, true);
          }
          if (analysisPanel && analysisPanel.applyAnalysisToBody) {
            analysisPanel.applyAnalysisToBody(bodyEl, anay, config);
          }

          checkIfFirstAnalysis(questionId, (isFirst) => {
            if (isFirst) {
              insertFirstAnalysisDisclaimer(bodyEl);
            }
          });

          // CU1-A: persist question metadata + stats when we have an ID
          if (analysisPanel && analysisPanel.recordQuestionAnalysis) {
            const mode =
              config && config.mode
                ? String(config.mode)
                : "unknown";

            const extras = {
              mode,
              fullText: trimmed,
              source: "analysis"
            };

            if (questionId) {
              analysisPanel.recordQuestionAnalysis(
                questionId,
                anay,
                extras
              );
            }
          }
        }
      );
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      const escapeHtml =
        analysis && analysis.escapeHtml
          ? analysis.escapeHtml
          : (x) => String(x);
      setBodyHtml(
        bodyEl,
        `<em>Extension error: ${escapeHtml(
          msg
        )}</em><br><small>Reload the Udemy page and try again.</small>`
      );
    }
  }

  function mount(analysisRoot, config) {
    if (!analysisRoot || !config) return;

    const bodyEl = analysisRoot.querySelector(".cz-tts-analysis-body");
    if (!bodyEl) return;

    // Initialize label based on prior state if any
    setAnalyzedLabel(analysisRoot, analysisRoot.dataset.czAnalyzed === "1");

    analysisRoot.addEventListener("click", (evt) => {
      const btn = evt.target.closest(
        "button.cz-tts-btn[data-action='analyze-question']"
      );
      if (!btn) return;

      const text = safeCall(config.getQuestionText);
      const qid = safeCall(config.getQuestionId) || null;
      analyzeQuestion(text, qid, bodyEl, config, analysisRoot);
    });
  }

  const questionInsight = {
    mount,
    applyAnalysisToBody:
      analysisPanel && analysisPanel.applyAnalysisToBody
        ? analysisPanel.applyAnalysisToBody
        : function () {},
    markAnalyzed: setAnalyzedLabel
  };

  window.czFeatures.questionInsight = questionInsight;
})();
