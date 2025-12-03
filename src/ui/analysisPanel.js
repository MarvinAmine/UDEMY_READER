// /src/ui/analysisPanel.js
(function () {
  window.czUI = window.czUI || {};
  if (window.czUI.analysisPanel) return;

  const log = (window.czCore && window.czCore.log) || (() => {});
  const analysis =
    (window.czEngines && window.czEngines.analysis) || null;

  function safeCall(fn) {
    try {
      return fn ? fn() : "";
    } catch (e) {
      log("AnalysisPanel", "config fn error", e);
      return "";
    }
  }

  function safeGetOptionLetters(config) {
    if (!config || typeof config.getOptionLetters !== "function") return [];
    try {
      const raw = config.getOptionLetters();
      if (!Array.isArray(raw)) return [];
      return raw
        .map((x) => String(x || "").trim().toUpperCase())
        .filter((x) => /^[A-Z]$/.test(x));
    } catch (e) {
      log("AnalysisPanel", "getOptionLetters error", e);
      return [];
    }
  }

  function applyAnalysisToBody(bodyEl, analysisJson, config) {
    if (!bodyEl || !analysisJson || !analysis || !analysis.renderAnalysis) {
      return;
    }
    const optionLetters = safeGetOptionLetters(config);
    const html = analysis.renderAnalysis(analysisJson, optionLetters);
    bodyEl.innerHTML = html;
  }

  function recordQuestionAnalysis(questionId, analysisJson) {
    if (!chrome?.storage?.local || !questionId) return;

    const tags = Array.isArray(analysisJson.topic_tags)
      ? analysisJson.topic_tags
      : [];

    chrome.storage.local.get(["czQuestionStats"], (res) => {
      const stats = res.czQuestionStats || {};
      const key = String(questionId);

      const existing = stats[key] || {
        attempts: 0,
        wrong: 0,
        tags: {},
        lastSeen: 0
      };

      existing.attempts = (existing.attempts || 0) + 1;
      existing.lastSeen = Date.now();

      tags.forEach((t) => {
        const tag = String(t || "").trim();
        if (!tag) return;
        existing.tags[tag] = (existing.tags[tag] || 0) + 1;
      });

      stats[key] = existing;
      chrome.storage.local.set({ czQuestionStats: stats });
    });
  }

  window.czUI.analysisPanel = {
    applyAnalysisToBody,
    recordQuestionAnalysis
  };
})();
