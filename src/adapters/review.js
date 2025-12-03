// /src/adapters/review.js
// Review mode adapter (full review pages + inline result)

(function () {
  if (!window) return;
  if (!window.czLocations) window.czLocations = {};
  if (window.czLocations.reviewMode) return;

  const log = (window.czCore && window.czCore.log) || (() => {});

  const REVIEW_BLOCK_SELECTOR =
    ".result-pane--question-result-pane-wrapper--2bGiz";
  const INLINE_RESULT_SELECTOR =
    ".question-result--question-result--LWiOB";

  function normalizeWhitespace(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function findPromptEl(block) {
    if (!block) return null;
    return (
      block.querySelector("#question-prompt") ||
      block.querySelector(".result-pane--question-format--PBvdY")
    );
  }

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
      questionText + (answers.length ? "\n\n" + answers.join("\n") : "")
    );
  }

  function extractReviewExplanation(block) {
    if (!block) return "";
    const overallExplanation = block.querySelector("#overall-explanation");
    if (!overallExplanation) return "";
    return normalizeWhitespace(overallExplanation.innerText || "");
  }

  function getOptionLettersReview(block) {
    if (!block) return [];
    const answerBodies = block.querySelectorAll(
      ".answer-result-pane--answer-body--cDGY6"
    );
    return Array.from(answerBodies).map((_, idx) =>
      String.fromCharCode(65 + idx)
    );
  }

  function getHighlightRootsReview(block, action) {
    if (!block) return [];
    const roots = [];

    const promptEl = findPromptEl(block);
    const answerBodies = block.querySelectorAll(
      ".answer-result-pane--answer-body--cDGY6"
    );
    const overallExplanation = block.querySelector("#overall-explanation");

    if (!action || action === "play-question") {
      if (promptEl) roots.push(promptEl);
      answerBodies.forEach((el) => roots.push(el));
      return roots;
    }

    if (action === "play-question-expl") {
      if (overallExplanation) roots.push(overallExplanation);
      return roots;
    }

    if (action === "play-selection") {
      return [];
    }

    if (promptEl) roots.push(promptEl);
    answerBodies.forEach((el) => roots.push(el));
    if (overallExplanation) roots.push(overallExplanation);
    return roots;
  }

  function restoreCachedInsightForBlock(block, wrapper, insightConfig) {
    if (!chrome?.runtime?.sendMessage) return;

    const analysisBody = wrapper.querySelector(".cz-tts-analysis-body");
    if (!analysisBody) return;

    const textRaw = insightConfig.getQuestionText
      ? insightConfig.getQuestionText()
      : "";
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
      log("ReviewMode", "restoreCachedInsightForBlock error", e);
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
        <button type="button" class="cz-tts-btn cz-tts-collapse-toggle" data-action="toggle-collapse">
          ▾ Hide all
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

    promptEl.insertAdjacentElement("afterend", wrapper);
    block.dataset.czTtsInjected = "1";

    const quizFeature =
      window.czFeatures && window.czFeatures.quizReader;
    const insightFeature =
      window.czFeatures && window.czFeatures.questionInsight;

    if (!quizFeature) {
      log("ReviewMode", "quizReader feature missing");
      return;
    }

    const insightConfig = {
      getQuestionText: () => extractReviewQuestionStemAndAnswers(block),
      getOptionLetters: () => getOptionLettersReview(block)
    };

    quizFeature.mount(wrapper, {
      getText: () => extractReviewQuestionStemAndAnswers(block),
      getTextWithExplanation: () => extractReviewExplanation(block),
      getHighlightRoots: (action) => getHighlightRootsReview(block, action)
    });

    if (!insightFeature) {
      log("ReviewMode", "questionInsight feature missing");
      return;
    }

    const analysisRoot = wrapper.querySelector(".cz-tts-analysis");
    if (!analysisRoot) return;

    insightFeature.mount(analysisRoot, insightConfig);

    restoreCachedInsightForBlock(block, wrapper, insightConfig);

    log("ReviewMode", "Injected Quiz Reader + Question Insight into review block");
  }

  function scanAndInjectAll() {
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

  window.czLocations.reviewMode = {
    rescan: scanAndInjectAll
  };
})();
