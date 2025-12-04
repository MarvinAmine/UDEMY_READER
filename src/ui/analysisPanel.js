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

  /**
   * CU1-A
   * Persist per-question metadata + aggregated stats whenever
   * an analysis successfully completes.
   *
   * - Stores tag counts and analysis-usage counters in `czQuestionStats`:
   *   { tags: {tag: count}, analyzeInvocationCount, lastAnalyzedAt, ... }
   * - Stores rich question metadata in `czQuestionMeta`:
   *   { questionId, fullText, topicTags[], firstSeen, lastSeen,
   *     seenInModes: {mode: count}, sources: {source: count}, lastAnalysisAt }
   *
   * @param {string} questionId
   * @param {object} analysisJson
   * @param {object} [extras]  e.g. { mode: "practice"|"review", fullText: string, source: string }
   */
  function recordQuestionAnalysis(questionId, analysisJson, extras) {
    if (!chrome?.storage?.local || !questionId) return;

    const tags = Array.isArray(analysisJson.topic_tags)
      ? analysisJson.topic_tags
      : [];

    const now = Date.now();
    const fullText =
      (extras && (extras.fullText || extras.text)) || "";
    const mode =
      (extras && extras.mode) ? String(extras.mode) : "unknown";
    const source =
      (extras && extras.source) ? String(extras.source) : "analysis";

    chrome.storage.local.get(
      ["czQuestionStats", "czQuestionMeta"],
      (res) => {
        const stats = res.czQuestionStats || {};
        const meta = res.czQuestionMeta || {};
        const key = String(questionId);

        // ---- Aggregated stats for analysis usage (CU1-A) ----
        const existingStats = stats[key] || {
          attempts: 0,
          wrong: 0,
          tags: {},
          lastSeen: 0
        };

        existingStats.attempts = (existingStats.attempts || 0) + 1;
        existingStats.lastSeen = now;

        // Shared with UC1-C: how often "Analyze question" was invoked.
        existingStats.analyzeInvocationCount =
          (existingStats.analyzeInvocationCount || 0) + 1;
        existingStats.lastAnalyzedAt = now;

        if (!existingStats.tags) {
          existingStats.tags = {};
        }

        tags.forEach((t) => {
          const tag = String(t || "").trim();
          if (!tag) return;
          existingStats.tags[tag] =
            (existingStats.tags[tag] || 0) + 1;
        });

        stats[key] = existingStats;

        // ---- Question metadata (CU1-A) ----
        const existingMeta = meta[key] || null;
        const seenInModes = (existingMeta && existingMeta.seenInModes) || {};
        const sources = (existingMeta && existingMeta.sources) || {};

        if (mode && mode !== "unknown") {
          seenInModes[mode] = (seenInModes[mode] || 0) + 1;
        }

        if (source) {
          sources[source] = (sources[source] || 0) + 1;
        }

        const previousTags = Array.isArray(
          existingMeta && existingMeta.topicTags
        )
          ? existingMeta.topicTags
          : [];

        const mergedTags = Array.from(
          new Set(
            []
              .concat(previousTags || [])
              .concat(
                tags
                  .map((t) => String(t || "").trim())
                  .filter(Boolean)
              )
          )
        );

        const metaEntry = {
          questionId: key,
          fullText:
            fullText && fullText.length
              ? fullText
              : existingMeta && existingMeta.fullText
              ? existingMeta.fullText
              : "",
          topicTags: mergedTags,
          firstSeen:
            existingMeta && existingMeta.firstSeen
              ? existingMeta.firstSeen
              : now,
          lastSeen: now,
          seenInModes,
          sources,
          lastAnalysisAt: now
        };

        meta[key] = metaEntry;

        chrome.storage.local.set(
          {
            czQuestionStats: stats,
            czQuestionMeta: meta
          },
          () => {
            log(
              "AnalysisPanel",
              "CU1-A stored analysis for question",
              key,
              "mode=",
              mode,
              "tags=",
              tags
            );
          }
        );
      }
    );
  }

  window.czUI.analysisPanel = {
    applyAnalysisToBody,
    recordQuestionAnalysis
  };
})();
