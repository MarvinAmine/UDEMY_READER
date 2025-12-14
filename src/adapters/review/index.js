// File: /src/adapters/review/index.js
//
// Review mode adapter: mounts Quiz Reader + Question Insight and triggers UC1-B import.
// CU2: mounts the inline confidence strip on the same cz-tts-wrapper, linked by questionId.

(function () {
  if (typeof window === "undefined") return;
  if (!window.czLocations) window.czLocations = {};
  if (window.czLocations.reviewMode) return;

  const log = (window.czCore && window.czCore.log) || (() => {});

  const dom =
    (window.czAdapters && window.czAdapters.reviewDom) || {};
  const questionHelpers =
    (window.czAdapters && window.czAdapters.reviewQuestionId) || {};
  const importHelpers =
    (window.czAdapters && window.czAdapters.reviewImport) || {};
  const confidenceInline =
    window.czUI && window.czUI.confidenceInline;

  const REVIEW_BLOCK_SELECTOR =
    dom.REVIEW_BLOCK_SELECTOR ||
    ".result-pane--question-result-pane-wrapper--2bGiz";
  const INLINE_RESULT_SELECTOR =
    dom.INLINE_RESULT_SELECTOR ||
    ".question-result--question-result--LWiOB";

  let hasLoggedImportSkip = false;

  function isReviewPageUrl() {
    const path = window.location.pathname || "";
    return /\/quiz\/\d+\/(result|review)\//.test(path);
  }

  function isInlinePracticeResult() {
    // Practice mode "review-like" panel shown immediately after validation.
    return !!document.querySelector(INLINE_RESULT_SELECTOR);
  }

  function getReviewQuestionId(block) {
    if (questionHelpers.getReviewQuestionId) {
      return questionHelpers.getReviewQuestionId(block);
    }
    return null;
  }

  function getQuestionText(block) {
    if (dom.extractReviewQuestionStemAndAnswers) {
      return dom.extractReviewQuestionStemAndAnswers(block);
    }
    return "";
  }

  function getQuestionTextWithExplanation(block) {
    if (dom.extractReviewExplanation) {
      const expl = dom.extractReviewExplanation(block);
      if (expl && expl.trim()) {
        return getQuestionText(block) + "\n\nExplanation:\n" + expl;
      }
    }
    return getQuestionText(block);
  }

  function getExplanationText(block) {
    if (dom.extractReviewExplanation) {
      return dom.extractReviewExplanation(block) || "";
    }
    return "";
  }

  function getHighlightRoots(block, action) {
    if (dom.getHighlightRootsReview) {
      return dom.getHighlightRootsReview(block, action);
    }
    return [];
  }

  function getOptionLetters(block) {
    if (dom.getOptionLettersReview) {
      return dom.getOptionLettersReview(block);
    }
    return [];
  }

  function getAnswerElements(block) {
    if (!block) return [];
    const answers = block.querySelectorAll(
      ".answer-result-pane--answer-body--cDGY6"
    );
    return Array.from(answers);
  }

  function findPromptEl(block) {
    if (dom.findPromptEl) return dom.findPromptEl(block);
    if (!block) return null;
    return (
      block.querySelector("#question-prompt") ||
      block.querySelector(".result-pane--question-format--PBvdY")
    );
  }

  function restoreCachedInsightForBlock(block, wrapper, insightConfig) {
    if (!chrome?.runtime?.sendMessage) return;

    const analysisBody = wrapper.querySelector(".cz-tts-analysis-body");
    const analysisRoot = wrapper.querySelector(".cz-tts-analysis");
    if (!analysisBody) return;

    const textRaw = insightConfig.getQuestionText
      ? insightConfig.getQuestionText()
      : "";
    const text = (textRaw || "").trim();
    const questionId = getReviewQuestionId(block) || null;

    if (!text && !questionId) return;

    try {
      chrome.runtime.sendMessage(
        {
          type: "CZ_GET_CACHED_ANALYSIS",
          text,
          questionId
        },
        (resp) => {
          if (!resp || !resp.ok || !resp.analysis) return;

          const insightFeature =
            window.czFeatures && window.czFeatures.questionInsight;
          if (
            !insightFeature ||
            typeof insightFeature.applyAnalysisToBody !== "function"
          ) {
            return;
          }

          insightFeature.applyAnalysisToBody(
            analysisBody,
            resp.analysis,
            insightConfig
          );
          if (analysisRoot && insightFeature.markAnalyzed) {
            insightFeature.markAnalyzed(analysisRoot, true);
          }
          if (insightFeature.applyHighlightsFromAnalysis) {
            insightFeature.applyHighlightsFromAnalysis(
              resp.analysis,
              insightConfig
            );
          }
          if (analysisRoot && insightFeature.rememberAnalysis) {
            insightFeature.rememberAnalysis(
              analysisRoot,
              resp.analysis,
              insightConfig
            );
          }
        }
      );
    } catch (e) {
      log("ReviewMode", "restoreCachedInsightForBlock error", e);
    }
  }

  function injectCardForBlock(block, logInjection) {
    if (!block || block.dataset.czTtsInjected === "1") return;

    const promptEl = findPromptEl(block);
    if (!promptEl) return;

    const quizFeature =
      window.czFeatures && window.czFeatures.quizReader;
    const insightFeature =
      window.czFeatures && window.czFeatures.questionInsight;

    if (!quizFeature || !insightFeature) {
      log(
        "ReviewMode",
        "Missing feature(s): quiz=",
        !!quizFeature,
        "insight=",
        !!insightFeature
      );
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "cz-tts-wrapper cz-tts-review";
    wrapper.innerHTML =
      '<div class="cz-tts-toolbar">' +
      '<span class="cz-tts-title">Quiz Reader</span>' +
      '<button type="button" class="cz-tts-btn" data-action="play-question">' +
      "▶ Play Q + answers" +
      "</button>" +
      '<button type="button" class="cz-tts-btn" data-action="play-question-expl">' +
      "▶ Play explanation" +
      "</button>" +
      '<button type="button" class="cz-tts-btn" data-action="play-selection">' +
      "▶ Play selection" +
      "</button>" +
      '<button type="button" class="cz-tts-btn" data-action="stop" disabled>' +
      "⏹ Stop" +
      "</button>" +
      '<button type="button" class="cz-tts-btn cz-tts-collapse-toggle" data-action="toggle-collapse">' +
      "▾ Hide all" +
      "</button>" +
      "</div>" +
      '<div class="cz-tts-status">' +
      'Ready. Use “Play Q + answers” or “Play explanation”, or select text and use “Play selection”.' +
      "</div>" +
      '<div class="cz-tts-confidence-root"></div>' +
      '<div class="cz-tts-analysis">' +
      '<div class="cz-tts-analysis-header">' +
      '<span class="cz-tts-analysis-title">Question Insight</span>' +
      '<button type="button" class="cz-tts-btn" data-action="analyze-question">' +
      "🧠 Analyze question" +
      "</button>" +
      "</div>" +
      '<div class="cz-tts-analysis-body">' +
      "Click “Analyze question” to see a simplified stem, key triggers, and topic tags." +
      "</div>" +
      "</div>";

    promptEl.insertAdjacentElement("afterend", wrapper);
    block.dataset.czTtsInjected = "1";

    const insightConfig = {
      getQuestionText: () => getQuestionText(block),
      getExplanationText: () => getExplanationText(block),
      getQuestionId: () => getReviewQuestionId(block),
      getOptionLetters: () => getOptionLetters(block),
      getPromptElement: () => findPromptEl(block),
      getAnswerElements: () => getAnswerElements(block),
      mode: "review"
    };

    // Store questionId on wrapper for CU2 / stats
    const qid = getReviewQuestionId(block);
    if (qid && wrapper.dataset) {
      wrapper.dataset.czQuestionId = String(qid);
    }

    quizFeature.mount(wrapper, {
      getText: () => getQuestionText(block),
      getTextWithExplanation: () => getQuestionTextWithExplanation(block),
      getHighlightRoots: (action) => getHighlightRoots(block, action)
    });

    const analysisRoot = wrapper.querySelector(".cz-tts-analysis");
    if (analysisRoot) {
      insightFeature.mount(analysisRoot, insightConfig);
    }

    // CU2 – mount inline confidence (read-only in review mode)
    if (confidenceInline && typeof confidenceInline.mount === "function") {
      confidenceInline.mount(wrapper, {
        getQuestionId: () => getReviewQuestionId(block),
        mode: "review"
      });
    }

    restoreCachedInsightForBlock(block, wrapper, insightConfig);

    if (logInjection) {
      log(
        "ReviewMode",
        "Injected Quiz Reader + Question Insight into review block"
      );
    }
  }

  function scanAndInjectAll() {
    const inReviewUrl = isReviewPageUrl();
    const inPracticeInline = !inReviewUrl && isInlinePracticeResult();
    if (!inReviewUrl && !inPracticeInline) return;

    let blocks = document.querySelectorAll(REVIEW_BLOCK_SELECTOR);
    if (!blocks.length) {
      blocks = document.querySelectorAll(INLINE_RESULT_SELECTOR);
    }
    if (!blocks.length) return;

    // Only trigger UC1-B import on true review pages.
    if (inReviewUrl && typeof importHelpers.ensureReviewImportOnce === "function") {
      importHelpers.ensureReviewImportOnce();
    } else if (inPracticeInline && !hasLoggedImportSkip) {
      hasLoggedImportSkip = true;
    }

    blocks.forEach((block) => injectCardForBlock(block, inReviewUrl));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scanAndInjectAll);
  } else {
    scanAndInjectAll();
  }

  const observer = new MutationObserver(() => {
    scanAndInjectAll();
  });
  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });

  window.czLocations.reviewMode = {
    rescan: scanAndInjectAll
  };
})();
