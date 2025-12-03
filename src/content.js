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

  function analyzeQuestion(text, questionId, bodyEl, config) {
    const trimmed = (text || "").trim();
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
          text: trimmed,
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
          if (analysisPanel && analysisPanel.applyAnalysisToBody) {
            analysisPanel.applyAnalysisToBody(bodyEl, anay, config);
          }

          if (questionId && analysisPanel && analysisPanel.recordQuestionAnalysis) {
            analysisPanel.recordQuestionAnalysis(questionId, anay);
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

    analysisRoot.addEventListener("click", (evt) => {
      const btn = evt.target.closest(
        "button.cz-tts-btn[data-action='analyze-question']"
      );
      if (!btn) return;

      const text = safeCall(config.getQuestionText);
      const qid = safeCall(config.getQuestionId) || null;
      analyzeQuestion(text, qid, bodyEl, config);
    });
  }

  const questionInsight = {
    mount,
    applyAnalysisToBody:
      analysisPanel && analysisPanel.applyAnalysisToBody
        ? analysisPanel.applyAnalysisToBody
        : function () {}
  };

  window.czFeatures.questionInsight = questionInsight;
})();
