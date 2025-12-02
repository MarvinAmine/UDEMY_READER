// content/locations/reviewMode.js
(function () {
  if (window.czLocations && window.czLocations.reviewMode) return;

  function log(...args) {
    console.log("[UdemyReader][ReviewMode]", ...args);
  }

  // Full review pages wrap each question result in this container.
  const REVIEW_BLOCK_SELECTOR =
    ".result-pane--question-result-pane-wrapper--2bGiz";
  // Inline per-question result (after validating a single practice question)
  // uses this container.
  const INLINE_RESULT_SELECTOR =
    ".question-result--question-result--LWiOB";

  function findPromptEl(block) {
    if (!block) return null;
    return (
      block.querySelector("#question-prompt") ||
      block.querySelector(".result-pane--question-format--PBvdY")
    );
  }

  function normalizeWhitespace(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function safeCall(fn) {
    try {
      return fn ? fn() : "";
    } catch (e) {
      log("config fn error", e);
      return "";
    }
  }

  // Canonical "question + answers" text (no correctness meta)
  // Used both for TTS and for analysis cache keys.
  function extractReviewQuestionStemAndAnswers(block) {
    if (!block) return "";

    const promptEl = findPromptEl(block);
    const questionText = promptEl
      ? normalizeWhitespace(promptEl.innerText || "")
      : "";

    const answerBodies = block.querySelectorAll(
      ".answer-result-pane--answer-body--cDGY6"
    );

    const answers = Array.from(answerBodies).map((bodyEl, idx) => {
      const label = String.fromCharCode(65 + idx);
      const text = normalizeWhitespace(bodyEl.innerText || "");
      return `${label}. ${text}`;
    });

    return (
      questionText +
      (answers.length ? "\n\n" + answers.join("\n") : "")
    );
  }

  // Explanation only (for Play explanation)
  function extractReviewExplanation(block) {
    if (!block) return "";
    const overallExplanation = block.querySelector("#overall-explanation");
    if (!overallExplanation) return "";
    return normalizeWhitespace(overallExplanation.innerText || "");
  }

  // Option letters for Question Insight
  function getOptionLettersReview(block) {
    if (!block) return [];
    const answerBodies = block.querySelectorAll(
      ".answer-result-pane--answer-body--cDGY6"
    );
    return Array.from(answerBodies).map((_, idx) =>
      String.fromCharCode(65 + idx)
    );
  }

  // Highlighting roots depend on which play action is active
  function getHighlightRootsReview(block, action) {
    if (!block) return [];
    const roots = [];

    const promptEl = findPromptEl(block);
    const answerBodies = block.querySelectorAll(
      ".answer-result-pane--answer-body--cDGY6"
    );
    const overallExplanation = block.querySelector("#overall-explanation");

    // Default / Play Q + answers
    if (!action || action === "play-question") {
      if (promptEl) roots.push(promptEl);
      answerBodies.forEach((el) => roots.push(el));
      return roots;
    }

    // Play explanation
    if (action === "play-question-expl") {
      if (overallExplanation) roots.push(overallExplanation);
      return roots;
    }

    // For selection we don't pre-compute highlight roots
    if (action === "play-selection") {
      return [];
    }

    // Fallback – shouldn't normally hit
    if (promptEl) roots.push(promptEl);
    answerBodies.forEach((el) => roots.push(el));
    if (overallExplanation) roots.push(overallExplanation);
    return roots;
  }

  // Try to restore cached analysis for a review/inline result block
  // using the canonical "question + answers" text as key.
  function restoreCachedInsightForBlock(block, wrapper, insightConfig) {
    if (!chrome?.runtime?.sendMessage) return;

    const analysisBody = wrapper.querySelector(".cz-tts-analysis-body");
    if (!analysisBody) return;

    const textRaw = safeCall(insightConfig.getQuestionText);
    const text = (textRaw || "").trim();
    if (!text) return;

    try {
      chrome.runtime.sendMessage(
        {
          type: "CZ_GET_CACHED_ANALYSIS",
          text,
          questionId: null
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
        }
      );
    } catch (e) {
      log("restoreCachedInsightForBlock error", e);
    }
  }

  function injectCardForBlock(block) {
    if (!block || block.dataset.czTtsInjected === "1") return;

    const promptEl = findPromptEl(block);
    if (!promptEl) return;

    const wrapper = document.createElement("div");
    wrapper.className = "cz-tts-wrapper cz-tts-review";
    wrapper.innerHTML = `
      <div class="cz-tts-toolbar">
        <span class="cz-tts-title">Quiz Reader</span>
        <button type="button" class="cz-tts-btn" data-action="play-question">
          ▶ Play Q + answers
        </button>
        <button type="button" class="cz-tts-btn" data-action="play-question-expl">
          ▶ Play explanation
        </button>
        <button type="button" class="cz-tts-btn" data-action="play-selection">
          ▶ Play selection
        </button>
        <button type="button" class="cz-tts-btn" data-action="stop" disabled>
          ⏹ Stop
        </button>
      </div>
      <div class="cz-tts-status">
        Ready. Use “Play Q + answers” or select some text and use “Play selection”.
      </div>
      <div class="cz-tts-analysis">
        <div class="cz-tts-analysis-header">
          <span class="cz-tts-analysis-title">Question Insight</span>
          <button type="button" class="cz-tts-btn" data-action="analyze-question">
            🧠 Analyze question
          </button>
        </div>
        <div class="cz-tts-analysis-body">
          Click “Analyze question” to see a simplified stem, key triggers, and topic tags.
        </div>
      </div>
    `;

    // Insert right after the question prompt
    promptEl.insertAdjacentElement("afterend", wrapper);
    block.dataset.czTtsInjected = "1";

    const quizFeature =
      window.czFeatures && window.czFeatures.quizReader;
    const insightFeature =
      window.czFeatures && window.czFeatures.questionInsight;

    if (!quizFeature) {
      log("quizReader feature missing – did quizReaderFeature.js load?");
      return;
    }

    const insightConfig = {
      // For analysis & cache, use the same canonical text as practice mode
      getQuestionText: () => extractReviewQuestionStemAndAnswers(block),
      getOptionLetters: () => getOptionLettersReview(block)
    };

    // TTS wiring (Q + answers, explanation, selection)
    quizFeature.mount(wrapper, {
      getText: () => extractReviewQuestionStemAndAnswers(block),
      // This is wired to "Play explanation" (explanation only)
      getTextWithExplanation: () => extractReviewExplanation(block),
      getHighlightRoots: (action) => getHighlightRootsReview(block, action)
    });

    if (!insightFeature) {
      log("questionInsight feature missing – did questionInsightFeature.js load?");
      return;
    }

    const analysisRoot = wrapper.querySelector(".cz-tts-analysis");
    if (!analysisRoot) return;

    // Question Insight button, using canonical text
    insightFeature.mount(analysisRoot, insightConfig);

    // Try to restore cached analysis (from practice mode or previous views)
    restoreCachedInsightForBlock(block, wrapper, insightConfig);

    log("Injected Quiz Reader + Question Insight card into review question block.");
  }

  function scanAndInjectAll() {
    // Prefer full review blocks when present; otherwise fall back
    // to the inline per-question result container used in practice mode.
    let blocks = document.querySelectorAll(REVIEW_BLOCK_SELECTOR);
    if (!blocks.length) {
      blocks = document.querySelectorAll(INLINE_RESULT_SELECTOR);
    }
    if (!blocks.length) return;

    blocks.forEach(injectCardForBlock);
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

  window.czLocations = window.czLocations || {};
  window.czLocations.reviewMode = {
    rescan: scanAndInjectAll
  };
})();
